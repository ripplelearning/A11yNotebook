import { describe, expect, it, vi } from 'vitest';
import { resolveOutlookConflict, runOutlookSync } from '../shared/outlook-sync-run';
import type { ProviderTransport, PulledChange } from '../shared/calendar-sync-engine';
import type { CalendarAppointment } from '../shared/calendar';
import type { SyncStateFile } from '../shared/calendar-sync';

describe('outlook sync run', () => {
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
              provider: 'outlook',
              externalId: 'o-1',
              updatedAt: '2026-10-25T00:00:00.000Z',
            },
          },
        ] as PulledChange[],
        syncToken: 'tok-2',
      }),
      pushCreate: async () => ({ externalId: 'o-new' }),
      pushUpdate: async () => ({}),
      pushDelete: async () => undefined,
    };
    const result = await runOutlookSync({
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
    expect(savedLocal![0]).toMatchObject({ externalId: 'o-1', title: 'Dentist' });
    expect(savedState!.providers.outlook).toMatchObject({ syncToken: 'tok-2' });
  });

  it('surfaces conflicts instead of hiding them', async () => {
    const local: CalendarAppointment[] = [
      {
        id: 'local-1',
        title: 'Local title',
        start: '2026-11-02T10:00:00-08:00',
        allDay: false,
        provider: 'outlook',
        externalId: 'o-1',
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
              provider: 'outlook',
              externalId: 'o-1',
              updatedAt: '2026-10-25T00:00:00.000Z',
            },
          },
        ] as PulledChange[],
        syncToken: 'tok-2',
      }),
      pushCreate: async () => ({ externalId: 'o-new' }),
      pushUpdate: async () => ({}),
      pushDelete: async () => undefined,
    };
    const result = await runOutlookSync({
      getCalendar: async () => local,
      saveCalendar: async (items) => items,
      getSyncState: async () => ({
        version: 1,
        providers: { outlook: { provider: 'outlook', lastSyncAt: '2026-10-20T00:00:00.000Z' } },
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

describe('outlook conflict resolution', () => {
  const local: CalendarAppointment = {
    id: 'local-1',
    title: 'Local title',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    provider: 'outlook',
    externalId: 'o-1',
    updatedAt: '2026-10-26T00:00:00.000Z',
    link: { kind: 'note', path: 'Notes/Visit.md' },
    reminderMinutesBefore: 15,
  };
  const remote: CalendarAppointment = {
    id: 'remote-1',
    title: 'Remote title',
    start: '2026-11-02T11:00:00-08:00',
    allDay: false,
    provider: 'outlook',
    externalId: 'o-1',
    updatedAt: '2026-10-27T00:00:00.000Z',
  };
  function deps(overrides: Record<string, unknown> = {}) {
    const pushUpdate = vi.fn(async () => ({}));
    let saved: CalendarAppointment[] | null = null;
    let savedOptions: { source?: 'local' | 'sync' } | undefined;
    return {
      pushUpdate,
      saved: () => saved,
      savedOptions: () => savedOptions,
      deps: {
        getCalendar: async () => [local],
        saveCalendar: async (items: CalendarAppointment[], options?: { source?: 'local' | 'sync' }) => {
          saved = items;
          savedOptions = options;
          return items;
        },
        getSyncState: async () => ({ version: 1, providers: {}, tombstones: [] }) as SyncStateFile,
        saveSyncState: async (state: SyncStateFile) => state,
        getAccessToken: async () => 'token-1',
        createTransport: () => ({
          pull: async () => ({ changes: [], syncToken: undefined }),
          pushCreate: async () => ({ externalId: 'o-new' }),
          pushUpdate,
          pushDelete: async () => undefined,
        }),
        ...overrides,
      },
    };
  }

  it('keeps local by pushing it to Outlook', async () => {
    const { deps: d, pushUpdate } = deps();
    await resolveOutlookConflict(d, { local, remote }, 'local');
    expect(pushUpdate).toHaveBeenCalledTimes(1);
    expect(pushUpdate).toHaveBeenCalledWith(local);
  });

  it('takes Outlook by saving remote locally with source sync, keeping link and reminder', async () => {
    const { deps: d, saved, savedOptions } = deps();
    await resolveOutlookConflict(d, { local, remote }, 'remote');
    expect(savedOptions()).toEqual({ source: 'sync' });
    expect(saved()![0]).toMatchObject({
      id: 'local-1',
      title: 'Remote title',
      provider: 'outlook',
      externalId: 'o-1',
      link: { kind: 'note', path: 'Notes/Visit.md' },
      reminderMinutesBefore: 15,
    });
  });
});
