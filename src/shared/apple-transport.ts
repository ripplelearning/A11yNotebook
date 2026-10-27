import { DOMParser } from '@xmldom/xmldom';
import { fromAppleEvent, toAppleIcs } from './apple-calendar';
import type { CalendarAppointment } from './calendar';
import {
  SyncTokenExpiredError,
  type ProviderTransport,
  type PulledChange,
} from './calendar-sync-engine';

/**
 * Apple CalDAV transport for the sync engine. It owns only HTTP and the
 * CalDAV shape; it never stores credentials. The caller supplies an
 * Apple ID and app-specific password (a revocable, app-scoped credential,
 * never the main Apple ID password), and an optional fetch
 * implementation for tests.
 *
 * Sync semantics: discovery lists the VEVENT-capable calendars in the
 * user's calendar home set. Without a picked calendar, sync uses the
 * first one; with a pick saved in the library's sync state, sync uses
 * that calendar. RFC 6578 sync-collection REPORTs list changes and
 * calendar-multiget REPORTs fetch the changed events. A 403 on an
 * incremental sync-collection means Apple expired the sync token; that
 * surfaces as SyncTokenExpiredError and the engine retries once as a
 * full pull. Deletes of already-gone events (404) count as success, so
 * retries stay idempotent. Updates overwrite without etag
 * preconditions: the engine only pushes items that changed locally and
 * were not remotely touched, and conflicts are reported on pull before
 * any push.
 *
 * XML parsing uses the repo's existing xmldom dependency and matches
 * elements by local name, so server prefix choices do not matter.
 */

export interface AppleTransportFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type AppleTransportFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<AppleTransportFetchResponse>;

export interface AppleCredentials {
  appleId: string;
  appPassword: string;
}

export interface AppleTransportOptions extends AppleCredentials {
  fetchImpl?: AppleTransportFetch;
  /** Skip discovery (tests, or a previously discovered calendar). */
  calendarUrl?: string;
}

const CALDAV_SERVER = 'https://caldav.icloud.com';

export function appleBasicAuthHeader(credentials: AppleCredentials): string {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(`${credentials.appleId}:${credentials.appPassword}`).toString('base64')
      : btoa(`${credentials.appleId}:${credentials.appPassword}`);
  return `Basic ${encoded}`;
}

interface XmlNode {
  tagName?: string;
  textContent?: string | null;
  childNodes?: ArrayLike<XmlNode>;
  getAttribute?(name: string): string | null;
  getElementsByTagNameNS?(namespace: string, localName: string): ArrayLike<XmlNode>;
}

function localNameOf(node: XmlNode): string {
  return (node.tagName ?? '').split(':').pop() ?? '';
}

function childElements(node: XmlNode, localName: string): XmlNode[] {
  const found: XmlNode[] = [];
  const children = node.childNodes ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.tagName && localNameOf(child) === localName) found.push(child);
  }
  return found;
}

function firstChild(node: XmlNode, localName: string): XmlNode | undefined {
  return childElements(node, localName)[0];
}

function firstChildText(node: XmlNode, localName: string): string | null {
  const text = firstChild(node, localName)?.textContent?.trim();
  return text ? text : null;
}

/** The document element of a parsed response, or a throw for unreadable XML. */
function parseXml(text: string): XmlNode {
  const document = new DOMParser().parseFromString(text, 'text/xml') as unknown as {
    documentElement?: XmlNode;
  };
  if (!document.documentElement) throw new Error('Apple returned an unreadable response.');
  return document.documentElement;
}

function allElements(root: XmlNode, localName: string): XmlNode[] {
  const list = root.getElementsByTagNameNS?.('*', localName) ?? [];
  const found: XmlNode[] = [];
  for (let index = 0; index < list.length; index += 1) found.push(list[index]);
  return found;
}

function resolveHref(requestUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return new URL(href, requestUrl).href;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function newUid(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${random}@a11ynotebook`;
}

/** The href inside a named property element (principal, home set, ...). */
function propertyHref(root: XmlNode, propertyName: string): string | null {
  const property = allElements(root, propertyName)[0];
  if (!property) return null;
  return firstChildText(property, 'href');
}

/** First prop element of a response, for reading its properties. */
function responseProp(response: XmlNode): XmlNode {
  return firstChild(firstChild(response, 'propstat') ?? {}, 'prop') ?? {};
}

export interface DiscoveredAppleCalendar {
  url: string;
  displayName: string;
}

/**
 * Discover the user's first VEVENT-capable calendar: server root ->
 * current-user-principal -> calendar-home-set -> calendars. Throws a
 * plain-language error when any step fails, so the section can show it.
 */
export async function discoverAppleCalendar(input: {
  appleId: string;
  appPassword: string;
  fetchImpl: AppleTransportFetch;
  serverUrl?: string;
}): Promise<DiscoveredAppleCalendar> {
  const calendars = await listAppleCalendars(input);
  const first = calendars[0];
  if (!first) throw new Error('Apple returned no event calendar for this account.');
  return first;
}

/**
 * List every VEVENT-capable calendar in the user's calendar home set,
 * in the order Apple returns them: server root ->
 * current-user-principal -> calendar-home-set -> calendars. The picker
 * shows these names; the chosen calendar's URL is what sync uses.
 */
export async function listAppleCalendars(input: {
  appleId: string;
  appPassword: string;
  fetchImpl: AppleTransportFetch;
  serverUrl?: string;
}): Promise<DiscoveredAppleCalendar[]> {
  const auth = appleBasicAuthHeader({ appleId: input.appleId, appPassword: input.appPassword });
  const request = async (
    method: string,
    url: string,
    body: string,
    depth: '0' | '1',
  ): Promise<{ status: number; text: string }> => {
    const response = await input.fetchImpl(url, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: depth,
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Apple request failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }
    return { status: response.status, text };
  };
  const server = input.serverUrl ?? CALDAV_SERVER;
  const serverUrl = server.endsWith('/') ? server : `${server}/`;
  const root = await request(
    'PROPFIND',
    serverUrl,
    '<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal /></D:prop></D:propfind>',
    '0',
  );
  const principalHref = propertyHref(parseXml(root.text), 'current-user-principal');
  if (!principalHref) throw new Error('Apple did not return a user principal for this account.');
  const principalUrl = resolveHref(serverUrl, principalHref);
  const home = await request(
    'PROPFIND',
    principalUrl,
    '<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set /></D:prop></D:propfind>',
    '0',
  );
  const homeHref = propertyHref(parseXml(home.text), 'calendar-home-set');
  if (!homeHref) throw new Error('Apple did not return a calendar home for this account.');
  const homeUrl = resolveHref(principalUrl, homeHref);
  const listing = await request(
    'PROPFIND',
    homeUrl,
    '<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:resourcetype /><D:displayname /><C:supported-calendar-component-set /></D:prop></D:propfind>',
    '1',
  );
  const calendars: DiscoveredAppleCalendar[] = [];
  for (const response of allElements(parseXml(listing.text), 'response')) {
    const href = firstChildText(response, 'href');
    if (!href) continue;
    const prop = responseProp(response);
    const resourceType = firstChild(prop, 'resourcetype');
    const typeNames: string[] = [];
    if (resourceType?.childNodes) {
      for (let index = 0; index < resourceType.childNodes.length; index += 1) {
        const child = resourceType.childNodes[index];
        if (child.tagName) typeNames.push(localNameOf(child));
      }
    }
    if (!typeNames.includes('calendar')) continue;
    const components = firstChild(prop, 'supported-calendar-component-set');
    const compNames: string[] = [];
    if (components?.childNodes) {
      for (let index = 0; index < components.childNodes.length; index += 1) {
        const name = components.childNodes[index].getAttribute?.('name');
        if (name) compNames.push(name);
      }
    }
    if (!compNames.includes('VEVENT')) continue;
    calendars.push({
      url: resolveHref(homeUrl, href),
      displayName: firstChildText(prop, 'displayname') ?? 'Calendar',
    });
  }
  return calendars;
}

export class AppleTransport implements ProviderTransport {
  private readonly appleId: string;
  private readonly appPassword: string;
  private readonly fetchImpl: AppleTransportFetch;
  private cachedCalendarUrl: string | undefined;
  private resolvedCalendar: DiscoveredAppleCalendar | undefined;

  constructor(options: AppleTransportOptions) {
    this.appleId = options.appleId;
    this.appPassword = options.appPassword;
    this.fetchImpl =
      options.fetchImpl ??
      ((globalThis.fetch as unknown as AppleTransportFetch) || (() => {
        throw new Error('No fetch implementation available for Apple transport.');
      }));
    this.cachedCalendarUrl = options.calendarUrl;
  }

  /**
   * The calendar this transport discovered, once known. Sync runs
   * record it in sync state so the picker can show the current
   * calendar even when the user never picked one. A picked calendar
   * needs no recording: its name is already in sync state.
   */
  resolvedCalendarInfo(): DiscoveredAppleCalendar | undefined {
    return this.resolvedCalendar;
  }

  private async request(
    method: string,
    url: string,
    body?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; text: string }> {
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: appleBasicAuthHeader({ appleId: this.appleId, appPassword: this.appPassword }),
        ...(body !== undefined ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
        ...extraHeaders,
      },
      body,
    });
    const text = await response.text();
    return { status: response.status, text };
  }

  private async calendarUrl(): Promise<string> {
    if (!this.cachedCalendarUrl) {
      const discovered = await discoverAppleCalendar({
        appleId: this.appleId,
        appPassword: this.appPassword,
        fetchImpl: this.fetchImpl,
      });
      this.cachedCalendarUrl = discovered.url;
      this.resolvedCalendar = discovered;
    }
    return this.cachedCalendarUrl;
  }

  async pull(syncToken?: string): Promise<{ changes: PulledChange[]; syncToken?: string }> {
    const url = await this.calendarUrl();
    const syncBody =
      `<C:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<C:sync-token>${syncToken ? escapeXml(syncToken) : ''}</C:sync-token>` +
      `<C:sync-level>1</C:sync-level>` +
      `<D:prop><D:getetag /></D:prop></C:sync-collection>`;
    const sync = await this.request('REPORT', url, syncBody);
    if (sync.status === 403 && syncToken) {
      throw new SyncTokenExpiredError();
    }
    if (sync.status >= 400) {
      throw new Error(
        `Apple request failed (${sync.status})${sync.text ? `: ${sync.text.slice(0, 200)}` : ''}`,
      );
    }
    const syncDocument = parseXml(sync.text);
    const newToken = firstChildText(syncDocument, 'sync-token') ?? undefined;
    const changedHrefs: string[] = [];
    const changes: PulledChange[] = [];
    for (const response of allElements(syncDocument, 'response')) {
      const href = firstChildText(response, 'href');
      const status = firstChildText(response, 'status') ?? '';
      if (!href) continue;
      if (/\b404\b/.test(status)) {
        changes.push({ kind: 'deleted', externalId: hrefToUid(href) });
      } else if (/\b2\d\d\b/.test(status)) {
        changedHrefs.push(href);
      }
    }
    if (changedHrefs.length > 0) {
      const multigetBody =
        `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
        `<D:prop><C:calendar-data /></D:prop>` +
        changedHrefs.map((href) => `<D:href>${escapeXml(href)}</D:href>`).join('') +
        `</C:calendar-multiget>`;
      const multiget = await this.request('REPORT', url, multigetBody);
      if (multiget.status >= 400) {
        throw new Error(
          `Apple request failed (${multiget.status})${multiget.text ? `: ${multiget.text.slice(0, 200)}` : ''}`,
        );
      }
      for (const response of allElements(parseXml(multiget.text), 'response')) {
        const data = firstChildText(responseProp(response), 'calendar-data');
        if (!data) continue;
        const mapped = fromAppleEvent(data);
        if (mapped === 'cancelled') {
          const href = firstChildText(response, 'href');
          if (href) changes.push({ kind: 'deleted', externalId: hrefToUid(href) });
        } else if (mapped) {
          changes.push({ kind: 'upsert', appointment: mapped });
        }
      }
    }
    return { changes, syncToken: newToken };
  }

  async pushCreate(appointment: CalendarAppointment): Promise<{ externalId: string }> {
    const url = await this.calendarUrl();
    const uid = newUid();
    const eventUrl = `${url.replace(/\/$/, '')}/${encodeURIComponent(uid)}.ics`;
    const put = await this.request('PUT', eventUrl, toAppleIcs(appointment, uid), {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    });
    if (put.status >= 400) {
      throw new Error(
        `Apple request failed (${put.status})${put.text ? `: ${put.text.slice(0, 200)}` : ''}`,
      );
    }
    return { externalId: uid };
  }

  async pushUpdate(appointment: CalendarAppointment): Promise<Record<string, never>> {
    if (!appointment.externalId) {
      throw new Error('Cannot update an Apple event without an event id.');
    }
    const url = await this.calendarUrl();
    const eventUrl = `${url.replace(/\/$/, '')}/${encodeURIComponent(appointment.externalId)}.ics`;
    const put = await this.request('PUT', eventUrl, toAppleIcs(appointment, appointment.externalId), {
      'Content-Type': 'text/calendar; charset=utf-8',
    });
    if (put.status >= 400) {
      throw new Error(
        `Apple request failed (${put.status})${put.text ? `: ${put.text.slice(0, 200)}` : ''}`,
      );
    }
    return {};
  }

  async pushDelete(externalId: string): Promise<void> {
    const url = await this.calendarUrl();
    const eventUrl = `${url.replace(/\/$/, '')}/${encodeURIComponent(externalId)}.ics`;
    const deleted = await this.request('DELETE', eventUrl);
    if (deleted.status >= 400 && deleted.status !== 404) {
      throw new Error(
        `Apple request failed (${deleted.status})${deleted.text ? `: ${deleted.text.slice(0, 200)}` : ''}`,
      );
    }
  }
}

/** The UID for a sync-collection deletion href (last path segment, minus .ics). */
function hrefToUid(href: string): string {
  const decoded = decodeURIComponent(href);
  const segment = decoded.split('/').filter(Boolean).pop() ?? decoded;
  return segment.endsWith('.ics') ? segment.slice(0, -4) : segment;
}
