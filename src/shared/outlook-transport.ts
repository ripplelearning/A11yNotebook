import {
  SyncTokenExpiredError,
  type ProviderTransport,
  type PulledChange,
} from './calendar-sync-engine';
import { fromOutlookEvent, toOutlookEvent, type OutlookEvent } from './outlook-calendar';
import type { CalendarAppointment } from './calendar';

const BASE_URL = 'https://graph.microsoft.com/v1.0';
const DELTA_SELECT = [
  'id',
  'subject',
  'body',
  'location',
  'start',
  'end',
  'isAllDay',
  'recurrence',
  'seriesMasterId',
  'lastModifiedDateTime',
].join(',');

export interface OutlookTransportFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type OutlookTransportFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<OutlookTransportFetchResponse>;

export interface OutlookTransportOptions {
  accessToken: string;
  fetchImpl?: OutlookTransportFetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Microsoft Graph transport for the sync engine. Pulls use the events
 * delta endpoint: pages carry @odata.nextLink, the final page carries
 * @odata.deltaLink, and that link is the sync token the engine stores and
 * passes back. Deleted events arrive as @removed entries. Series
 * instances (occurrences and exceptions) are skipped; their master
 * carries the series.
 */
export class OutlookTransport implements ProviderTransport {
  private readonly accessToken: string;
  private readonly fetchImpl: OutlookTransportFetch;

  constructor(options: OutlookTransportOptions) {
    this.accessToken = options.accessToken;
    this.fetchImpl =
      options.fetchImpl ??
      ((globalThis.fetch as unknown as OutlookTransportFetch) || (() => {
        throw new Error('No fetch implementation available for Outlook transport.');
      }));
  }

  private async request(
    urlOrPath: string,
    init?: { method?: string; body?: string },
  ): Promise<{ status: number; data: unknown }> {
    const url = urlOrPath.startsWith('https://') ? urlOrPath : `${BASE_URL}${urlOrPath}`;
    const response = await this.fetchImpl(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Outlook request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, data };
  }

  async pull(syncToken?: string): Promise<{ changes: PulledChange[]; syncToken?: string }> {
    const changes: PulledChange[] = [];
    let url = syncToken?.startsWith('https://')
      ? syncToken
      : `/me/events/delta?${new URLSearchParams({ $select: DELTA_SELECT }).toString()}`;
    let nextSyncToken: string | undefined;
    let guard = 0;
    do {
      let response: { status: number; data: unknown };
      try {
        response = await this.request(url, {});
      } catch (error) {
        if (
          syncToken &&
          error instanceof Error &&
          error.message.includes('Outlook request failed (410)')
        ) {
          throw new SyncTokenExpiredError();
        }
        throw error;
      }
      const data = isRecord(response.data) ? response.data : {};
      const items = Array.isArray(data.value) ? data.value : [];
      for (const raw of items) {
        if (!isRecord(raw)) continue;
        const eventId = raw.id;
        if (typeof eventId !== 'string' || !eventId) continue;
        if ('@removed' in raw) {
          changes.push({ kind: 'deleted', externalId: eventId });
          continue;
        }
        const mapped = fromOutlookEvent(raw as unknown as OutlookEvent);
        if (mapped !== null) {
          changes.push({ kind: 'upsert', appointment: mapped });
        }
        // Unusable remote events (including series instances and relative
        // recurrence) are skipped, never deleted locally.
      }
      url =
        typeof data['@odata.nextLink'] === 'string' ? (data['@odata.nextLink'] as string) : '';
      if (typeof data['@odata.deltaLink'] === 'string') {
        nextSyncToken = data['@odata.deltaLink'] as string;
      }
      guard += 1;
    } while (url && guard < 100);
    return { changes, syncToken: nextSyncToken };
  }

  async pushCreate(
    appointment: CalendarAppointment,
  ): Promise<{ externalId: string; updatedAt?: string }> {
    const { data } = await this.request('/me/events', {
      method: 'POST',
      body: JSON.stringify(toOutlookEvent(appointment)),
    });
    if (!isRecord(data) || typeof data.id !== 'string' || !data.id) {
      throw new Error('Outlook create did not return an event id.');
    }
    return {
      externalId: data.id,
      ...(typeof data.lastModifiedDateTime === 'string'
        ? { updatedAt: data.lastModifiedDateTime }
        : {}),
    };
  }

  async pushUpdate(appointment: CalendarAppointment): Promise<{ updatedAt?: string }> {
    if (!appointment.externalId) {
      throw new Error('Cannot update an Outlook event without an external id.');
    }
    const { data } = await this.request(
      `/me/events/${encodeURIComponent(appointment.externalId)}`,
      { method: 'PUT', body: JSON.stringify(toOutlookEvent(appointment)) },
    );
    return {
      ...(isRecord(data) && typeof data.lastModifiedDateTime === 'string'
        ? { updatedAt: data.lastModifiedDateTime }
        : {}),
    };
  }

  async pushDelete(externalId: string): Promise<void> {
    try {
      await this.request(`/me/events/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Outlook request failed (404)')) return;
      throw error;
    }
  }
}
