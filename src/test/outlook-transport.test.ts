import { describe, expect, it, vi } from 'vitest';
import { SyncTokenExpiredError } from '../shared/calendar-sync-engine';
import { OutlookTransport, type OutlookTransportFetch } from '../shared/outlook-transport';

function response(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

describe('outlook transport', () => {
  it('pulls delta pages, maps events, reports removals, and returns the delta link', async () => {
    const seen: string[] = [];
    const fetchImpl: OutlookTransportFetch = vi.fn(async (url) => {
      seen.push(url);
      if (url.includes('skiptoken')) {
        return response(200, { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-link' });
      }
      if (url.includes('delta')) {
        return response(200, {
          value: [
            {
              id: 'o-1',
              subject: 'Checkup',
              start: { dateTime: '2026-11-02T18:00:00.0000000', timeZone: 'UTC' },
              lastModifiedDateTime: '2026-10-27T00:00:00Z',
            },
            { id: 'o-2', '@removed': { reason: 'deleted' } },
            { id: 'o-3', seriesMasterId: 'o-master' },
            { subject: 'No id' },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/events/delta?$skiptoken=page2',
        });
      }
      return response(200, { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-link' });
    });
    const transport = new OutlookTransport({ accessToken: 'token-1', fetchImpl });
    const result = await transport.pull();
    expect(seen[0]).toContain('/me/events/delta');
    expect(seen[1]).toBe('https://graph.microsoft.com/v1.0/me/events/delta?$skiptoken=page2');
    expect(result.syncToken).toBe('https://graph.microsoft.com/v1.0/delta-link');
    expect(result.changes).toEqual([
      {
        kind: 'upsert',
        appointment: expect.objectContaining({ externalId: 'o-1', title: 'Checkup' }),
      },
      { kind: 'deleted', externalId: 'o-2' },
    ]);
  });

  it('reuses a stored delta link and converts an expired one into a token error', async () => {
    const fetchImpl: OutlookTransportFetch = vi.fn(async (url) => {
      if (url === 'https://graph.microsoft.com/v1.0/delta-link') {
        return response(200, { value: [] });
      }
      return response(410, { error: { code: 'SyncStateNotFound' } });
    });
    const transport = new OutlookTransport({ accessToken: 'token-1', fetchImpl });
    await transport.pull('https://graph.microsoft.com/v1.0/delta-link');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/delta-link',
      expect.objectContaining({ method: 'GET' }),
    );
    await expect(transport.pull('https://graph.microsoft.com/v1.0/expired')).rejects.toBeInstanceOf(
      SyncTokenExpiredError,
    );
  });

  it('creates, updates, and deletes events, treating a missing delete as success', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl: OutlookTransportFetch = vi.fn(async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (init?.method === 'POST') return response(201, { id: 'o-new', lastModifiedDateTime: '2026-10-27T00:00:00Z' });
      if (init?.method === 'PUT') return response(200, { lastModifiedDateTime: '2026-10-28T00:00:00Z' });
      return response(404, { error: { code: 'ErrorItemNotFound' } });
    });
    const transport = new OutlookTransport({ accessToken: 'token-1', fetchImpl });
    const created = await transport.pushCreate({
      id: 'local-1',
      title: 'Checkup',
      start: '2026-11-02T10:00:00-08:00',
      allDay: false,
    });
    expect(created).toEqual({ externalId: 'o-new', updatedAt: '2026-10-27T00:00:00Z' });
    expect(JSON.parse(calls[0].body!).subject).toBe('Checkup');
    await expect(
      transport.pushUpdate({ id: 'local-2', title: 'No link', start: '2026-11-02', allDay: true }),
    ).rejects.toThrow('without an external id');
    const updated = await transport.pushUpdate({
      id: 'local-1',
      title: 'Checkup',
      start: '2026-11-02T10:00:00-08:00',
      allDay: false,
      provider: 'outlook',
      externalId: 'o-1',
    });
    expect(updated).toEqual({ updatedAt: '2026-10-28T00:00:00Z' });
    await expect(transport.pushDelete('o-1')).resolves.toBeUndefined();
  });
});
