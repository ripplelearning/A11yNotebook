import { fromGoogleEvent, toGoogleEvent, type GoogleCalendarEvent } from './google-calendar';
import type { CalendarAppointment } from './calendar';
import {
  SyncTokenExpiredError,
  type ProviderTransport,
  type PulledChange,
} from './calendar-sync-engine';

/**
 * Google Calendar transport for the sync engine. It owns only HTTP and the
 * Google event shape; it never stores credentials. The caller supplies a
 * current access token (refresh and sign-in live in the auth layer) and an
 * optional fetch implementation for tests.
 *
 * Sync semantics: series, not expanded occurrences, so singleEvents stays
 * off and showDeleted stays on. A 410 on an incremental pull means Google
 * expired the sync token; that surfaces as SyncTokenExpiredError and the
 * engine retries once as a full pull. Deletes of already-gone events
 * (404/410) count as success, so retries stay idempotent.
 */

export interface GoogleTransportFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type GoogleTransportFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<GoogleTransportFetchResponse>;

export interface GoogleTransportOptions {
  accessToken: string;
  fetchImpl?: GoogleTransportFetch;
}

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class GoogleTransport implements ProviderTransport {
  private readonly accessToken: string;
  private readonly fetchImpl: GoogleTransportFetch;
  private cachedTimeZone: string | undefined;
  private timeZoneLoaded = false;

  constructor(options: GoogleTransportOptions) {
    this.accessToken = options.accessToken;
    this.fetchImpl =
      options.fetchImpl ??
      ((globalThis.fetch as unknown as GoogleTransportFetch) || (() => {
        throw new Error('No fetch implementation available for Google transport.');
      }));
  }

  private async request(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<{ status: number; data: unknown }> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Google Calendar request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, data };
  }

  /** Calendar time zone for UNTIL conversion; falls back silently. */
  private async getTimeZone(): Promise<string | undefined> {
    if (this.timeZoneLoaded) return this.cachedTimeZone;
    this.timeZoneLoaded = true;
    try {
      const { data } = await this.request('/calendars/primary?fields=timeZone');
      if (isRecord(data) && typeof data.timeZone === 'string' && data.timeZone) {
        this.cachedTimeZone = data.timeZone;
      }
    } catch {
      this.cachedTimeZone = undefined;
    }
    return this.cachedTimeZone;
  }

  async pull(syncToken?: string): Promise<{ changes: PulledChange[]; syncToken?: string }> {
    const changes: PulledChange[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    let guard = 0;
    do {
      const params = new URLSearchParams({ showDeleted: 'true', maxResults: '250' });
      if (syncToken) params.set('syncToken', syncToken);
      if (pageToken) params.set('pageToken', pageToken);
      let response: { status: number; data: unknown };
      try {
        response = await this.request(`/calendars/primary/events?${params.toString()}`);
      } catch (error) {
        if (
          syncToken &&
          error instanceof Error &&
          error.message.includes('Google Calendar request failed (410)')
        ) {
          throw new SyncTokenExpiredError();
        }
        throw error;
      }
      const data = isRecord(response.data) ? response.data : {};
      const items = Array.isArray(data.items) ? data.items : [];
      const timeZone = await this.getTimeZone();
      for (const raw of items) {
        if (!isRecord(raw)) continue;
        const eventId = raw.id;
        if (typeof eventId !== 'string' || !eventId) continue;
        const event = raw as unknown as GoogleCalendarEvent;
        if (event.status === 'cancelled') {
          changes.push({ kind: 'deleted', externalId: eventId });
          continue;
        }
        const mapped = fromGoogleEvent(event, { timeZone });
        if (mapped === 'cancelled') {
          changes.push({ kind: 'deleted', externalId: eventId });
        } else if (mapped !== null) {
          changes.push({ kind: 'upsert', appointment: mapped });
        }
        // Unusable remote events are skipped, never deleted locally.
      }
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
      if (typeof data.nextSyncToken === 'string') nextSyncToken = data.nextSyncToken;
      guard += 1;
    } while (pageToken && guard < 100);
    return { changes, syncToken: nextSyncToken };
  }

  async pushCreate(
    appointment: CalendarAppointment,
  ): Promise<{ externalId: string; updatedAt?: string }> {
    const { data } = await this.request('/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify(toGoogleEvent(appointment)),
    });
    if (!isRecord(data) || typeof data.id !== 'string' || !data.id) {
      throw new Error('Google Calendar create did not return an event id.');
    }
    return {
      externalId: data.id,
      ...(typeof data.updated === 'string' ? { updatedAt: data.updated } : {}),
    };
  }

  async pushUpdate(appointment: CalendarAppointment): Promise<{ updatedAt?: string }> {
    if (!appointment.externalId) {
      throw new Error('Cannot update a Google event without an external id.');
    }
    const { data } = await this.request(
      `/calendars/primary/events/${encodeURIComponent(appointment.externalId)}`,
      { method: 'PUT', body: JSON.stringify(toGoogleEvent(appointment)) },
    );
    return {
      ...(isRecord(data) && typeof data.updated === 'string'
        ? { updatedAt: data.updated }
        : {}),
    };
  }

  async pushDelete(externalId: string): Promise<void> {
    try {
      await this.request(`/calendars/primary/events/${encodeURIComponent(externalId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('Google Calendar request failed (404)') ||
          error.message.includes('Google Calendar request failed (410)'))
      ) {
        return;
      }
      throw error;
    }
  }
}
