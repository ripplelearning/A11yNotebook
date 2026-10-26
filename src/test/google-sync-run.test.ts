import { describe, expect, it } from 'vitest';
import { runGoogleSync } from '../shared/google-sync-run';
import type { ProviderTransport, PulledChange } from '../shared/calendar-sync-engine';
import type { CalendarAppointment } from '../shared/calendar';
import type { SyncStateFile } from '../shared/calendar-sync';

describe('google sync run', () => {
  it('runs a full sync through storage callbacks and a fake transport', async () => {
    const local: CalendarAppointment[] = [];
    let savedLocal: CalendarAppointment[] | null = null;
    let savedState: SyncStateFile | null = null;
    const seenTokens: string[] = [];
    const transport: ProviderTransport = {
      pull: async () => ({
        changes: [
          {
            kind: 'upsert',
            appointment: {
              title: 'Dentist',
              start: '2026-11-02T10:00:00-08:00',
              allDay: false,
              provider: 'google',
              externalId: 'g-1',
              updatedAt: '2026-10-25T00:00:00.000Z',
            },
          },
        ] as PulledChange[],
        syncToken: 'tok-2',
      }),
      pushCreate: async () => ({ externalId: 'g-new' }),
      pushUpdate: async () => ({}),
      pushDelete: async () => undefined,
    };
    const result = await runGoogleSync({
      getCalendar: async () => local,
      saveCalendar: async (items, options) => {
        expect(options).toEqual({ source: 'sync' });
        savedLocal = items;
        return items;
      },
      getSyncState: async () => ({ version: 1, providers: {}, tombstones: [] }),
      saveSyncState: async (state) => {
        savedState = state;
        return state;
      },
      getAccessToken: async () => 'token-1',
      createTransport: (token) => {
        seenTokens.push(token);
        return transport;
      },
    });
    expect(seenTokens).toEqual(['token-1']);
    expect(result).toMatchObject({ pulled: 1, pushed: 0, deleted: 0 });
    expect(result.conflicts).toEqual([]);
    expect(savedLocal).toHaveLength(1);
    expect(savedLocal![0]).toMatchObject({ externalId: 'g-1', title: 'Dentist' });
    expect(savedState!.providers.google).toMatchObject({ syncToken: 'tok-2' });
  });

  it('surfaces conflicts instead of hiding them', async () => {
    const local: CalendarAppointment[] = [
      {
        id: 'local-1',
        title: 'Local title',
        start: '2026-11-02T10:00:00-08:00',
        allDay: false,
        provider: 'google',
        externalId: 'g-1',
        updatedAt: '2026-10-25T00:00:00.000Z',
      },
    ];
    const transport: ProviderTransport = {
      pull: async () => ({
        changes: [
          {
            kind: 'upsert',
            appointment: {
              title: 'Remote title',
              start: '2026-11-02T10:00:00-08:00',
              allDay: false,
              provider: 'google',
              externalId: 'g-1',
              updatedAt: '2026-10-25T00:00:00.000Z',
            },
          },
        ] as PulledChange[],
        syncToken: 'tok-2',
      }),
      pushCreate: async () => ({ externalId: 'g-new' }),
      pushUpdate: async () => ({}),
      pushDelete: async () => undefined,
    };
    const result = await runGoogleSync({
      getCalendar: async () => local,
      saveCalendar: async (items) => items,
      getSyncState: async () => ({
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: '2026-10-20T00:00:00.000Z' } },
        tombstones: [],
      }),
      saveSyncState: async (state) => state,
      getAccessToken: async () => 'token-1',
      createTransport: () => transport,
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].local.title).toBe('Local title');
    expect(result.conflicts[0].remote.title).toBe('Remote title');
  });
});
