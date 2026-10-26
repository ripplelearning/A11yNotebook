import { describe, expect, it, vi } from 'vitest';
import { GoogleTransport } from '../shared/google-transport';
import { SyncTokenExpiredError } from '../shared/calendar-sync-engine';
import type { CalendarAppointment } from '../shared/calendar';

interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function response(status: number, data: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

describe('google transport', () => {
  it('pulls across pages, mapping upserts and cancellations', async () => {
    const calls: string[] = [];
    const inits: Array<{ headers?: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(url);
      inits.push(init ?? {});
      if (url.includes('/calendars/primary?fields=timeZone')) {
        return response(200, { timeZone: 'America/Los_Angeles' });
      }
      if (url.includes('pageToken=next')) {
        return response(200, {
          items: [{ id: 'g-2', status: 'cancelled' }],
          nextSyncToken: 'tok-2',
        });
      }
      return response(200, {
        items: [
          {
            id: 'g-1',
            summary: 'Dentist',
            start: { dateTime: '2026-10-06T14:30:00Z' },
            end: { dateTime: '2026-10-06T15:30:00Z' },
            updated: '2026-10-01T00:00:00Z',
          },
        ],
        nextPageToken: 'next',
      });
    });
    const transport = new GoogleTransport({ accessToken: 'tok', fetchImpl });
    const result = await transport.pull('tok-1');
    expect(result.syncToken).toBe('tok-2');
    expect(result.changes).toEqual([
      {
        kind: 'upsert',
        appointment: expect.objectContaining({ externalId: 'g-1', title: 'Dentist' }),
      },
      { kind: 'deleted', externalId: 'g-2' },
    ]);
    expect(calls.some((url) => url.includes('syncToken=tok-1'))).toBe(true);
    expect(calls.some((url) => url.includes('showDeleted=true'))).toBe(true);
    expect(inits[0].headers).toMatchObject({
      Authorization: 'Bearer tok',
    });
  });

  it('turns a 410 on an incremental pull into a token-expired error', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/calendars/primary?fields=timeZone')) {
        return response(200, {});
      }
      return response(410, { error: 'expired' });
    });
    const transport = new GoogleTransport({ accessToken: 'tok', fetchImpl });
    await expect(transport.pull('tok-1')).rejects.toBeInstanceOf(SyncTokenExpiredError);
    await expect(transport.pull(undefined)).rejects.not.toBeInstanceOf(
      SyncTokenExpiredError,
    );
  });

  it('creates, updates, and deletes with the right methods and bodies', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (init?.method === 'POST') return response(200, { id: 'g-new', updated: '2026-10-02T00:00:00Z' });
      if (init?.method === 'PUT') return response(200, { updated: '2026-10-03T00:00:00Z' });
      return response(204, null);
    });
    const transport = new GoogleTransport({ accessToken: 'tok', fetchImpl });
    const appointment: CalendarAppointment = {
      id: 'local-1',
      title: 'Checkup',
      start: '2026-10-05T09:00:00-07:00',
      end: '2026-10-05T10:00:00-07:00',
      allDay: false,
    };
    const created = await transport.pushCreate(appointment);
    expect(created).toEqual({ externalId: 'g-new', updatedAt: '2026-10-02T00:00:00Z' });
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body ?? '{}').summary).toBe('Checkup');
    const updated = await transport.pushUpdate({ ...appointment, externalId: 'g-1' });
    expect(updated).toEqual({ updatedAt: '2026-10-03T00:00:00Z' });
    expect(calls[1].url).toContain('/events/g-1');
    expect(calls[1].method).toBe('PUT');
    await expect(transport.pushUpdate(appointment)).rejects.toThrow('external id');
    await transport.pushDelete('g-9');
    expect(calls[2].method).toBe('DELETE');
  });

  it('treats deleting an already-gone event as success but surfaces other errors', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('g-gone')) return response(404, { error: 'not found' });
      return response(500, { error: 'boom' });
    });
    const transport = new GoogleTransport({ accessToken: 'tok', fetchImpl });
    await expect(transport.pushDelete('g-gone')).resolves.toBeUndefined();
    await expect(transport.pushDelete('g-bad')).rejects.toThrow('500');
  });

  it('pulls without a time zone when the calendar lookup fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/calendars/primary?fields=timeZone')) {
        return response(500, { error: 'boom' });
      }
      return response(200, {
        items: [
          {
            id: 'g-1',
            summary: 'All day',
            start: { date: '2026-12-25' },
            end: { date: '2026-12-26' },
          },
        ],
        nextSyncToken: 'tok-9',
      });
    });
    const transport = new GoogleTransport({ accessToken: 'tok', fetchImpl });
    const result = await transport.pull(undefined);
    expect(result.changes).toHaveLength(1);
    expect(result.syncToken).toBe('tok-9');
  });
});
