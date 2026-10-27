import { describe, expect, it, vi } from 'vitest';
import { resolveAppleConflict, runAppleSync } from '../shared/apple-sync-run';
import { AppleTransport, type AppleTransportFetch } from '../shared/apple-transport';
import type { ProviderTransport, PulledChange } from '../shared/calendar-sync-engine';
import type { CalendarAppointment } from '../shared/calendar';
import type { SyncStateFile } from '../shared/calendar-sync';

describe('apple sync run', () => {
  it('runs a full sync through storage callbacks and a fake transport', async () => {
    const local: CalendarAppointment[] = [];
    let savedLocal: CalendarAppointment[] | null = null;
    let savedState: SyncStateFile | null = null;
    const seenCredentials: unknown[] = [];
    const transport: ProviderTransport = {
      pull: async () => ({
        changes: [
          {
            kind: 'upsert',
            appointment: {
              title: 'Dentist',
              start: '2026-11-02T10:00:00-08:00',
              allDay: false,
              provider: 'apple',
              externalId: 'a-1',
              updatedAt: '2026-10-25T00:00:00.000Z',
            },
          },
        ] as PulledChange[],
        syncToken: 'tok-2',
      }),
      pushCreate: async () => ({ externalId: 'a-new' }),
      pushUpdate: async () => ({}),
      pushDelete: async () => undefined,
    };
    const result = await runAppleSync({
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
      getCredentials: async () => ({ appleId: 'test@icloud.com', appPassword: 'pw' }),
      createTransport: (credentials) => {
        seenCredentials.push(credentials);
        return transport;
      },
    });
    expect(seenCredentials).toEqual([{ appleId: 'test@icloud.com', appPassword: 'pw' }]);
    expect(result).toMatchObject({ pulled: 1, pushed: 0, deleted: 0 });
    expect(result.conflicts).toEqual([]);
    expect(savedLocal).toHaveLength(1);
    expect(savedLocal![0]).toMatchObject({ externalId: 'a-1', title: 'Dentist' });
    expect(savedState!.providers.apple).toMatchObject({ syncToken: 'tok-2' });
  });

  it('passes a picked calendar URL to the transport instead of discovering', async () => {
    const seenOptions: unknown[] = [];
    await runAppleSync({
      getCalendar: async () => [],
      saveCalendar: async (items) => items,
      getSyncState: async () => ({
        version: 1,
        providers: {
          apple: {
            provider: 'apple',
            calendarUrl: 'https://caldav.icloud.com/123/calendars/family/',
            calendarName: 'Family',
          },
        },
        tombstones: [],
      }),
      saveSyncState: async (state) => state,
      getCredentials: async () => ({ appleId: 'test@icloud.com', appPassword: 'pw' }),
      createTransport: (options) => {
        seenOptions.push(options);
        return {
          pull: async () => ({ changes: [], syncToken: undefined }),
          pushCreate: async () => ({ externalId: 'a-new' }),
          pushUpdate: async () => ({}),
          pushDelete: async () => undefined,
        };
      },
    });
    expect(seenOptions).toEqual([
      {
        appleId: 'test@icloud.com',
        appPassword: 'pw',
        calendarUrl: 'https://caldav.icloud.com/123/calendars/family/',
      },
    ]);
  });

  it('records the discovered calendar in sync state when none is picked', async () => {
    const principalXml =
      '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/</D:href><D:propstat><D:prop>' +
      '<D:current-user-principal><D:href>/123/principals/users/test/</D:href></D:current-user-principal>' +
      '</D:prop></D:propstat></D:response></D:multistatus>';
    const homeXml =
      '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response>' +
      '<D:href>/123/principals/users/test/</D:href><D:propstat><D:prop>' +
      '<C:calendar-home-set><D:href>/123/calendars/</D:href></C:calendar-home-set>' +
      '</D:prop></D:propstat></D:response></D:multistatus>';
    const listingXml =
      '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<D:response><D:href>/123/calendars/main/</D:href><D:propstat><D:prop>' +
      '<D:resourcetype><D:collection /><C:calendar /></D:resourcetype>' +
      '<D:displayname>Calendar</D:displayname>' +
      '<C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>' +
      '</D:prop></D:propstat></D:response></D:multistatus>';
    const fetchImpl: AppleTransportFetch = async (url) => {
      let body = '';
      if (url === 'https://caldav.icloud.com/') body = principalXml;
      else if (url === 'https://caldav.icloud.com/123/principals/users/test/') body = homeXml;
      else if (url === 'https://caldav.icloud.com/123/calendars/') body = listingXml;
      else if (url === 'https://caldav.icloud.com/123/calendars/main/')
        body = '<D:multistatus xmlns:D="DAV:"><D:sync-token>tok-9</D:sync-token></D:multistatus>';
      else throw new Error(`Unexpected URL: ${url}`);
      return { ok: true, status: 207, text: async () => body };
    };
    let savedState: SyncStateFile = { version: 1, providers: {}, tombstones: [] };
    await runAppleSync({
      getCalendar: async () => [],
      saveCalendar: async (items) => items,
      getSyncState: async () => savedState,
      saveSyncState: async (state) => {
        savedState = state;
        return state;
      },
      getCredentials: async () => ({ appleId: 'test@icloud.com', appPassword: 'pw' }),
      createTransport: (options) => new AppleTransport({ ...options, fetchImpl }),
    });
    expect(savedState.providers.apple).toMatchObject({
      calendarUrl: 'https://caldav.icloud.com/123/calendars/main/',
      calendarName: 'Calendar',
      syncToken: 'tok-9',
    });
  });
});

describe('apple conflict resolution', () => {
  const local: CalendarAppointment = {
    id: 'local-1',
    title: 'Local title',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    provider: 'apple',
    externalId: 'a-1',
    updatedAt: '2026-10-26T00:00:00.000Z',
    link: { kind: 'note', path: 'Notes/Visit.md' },
    reminderMinutesBefore: 15,
  };
  const remote: CalendarAppointment = {
    id: 'remote-1',
    title: 'Remote title',
    start: '2026-11-02T11:00:00-08:00',
    allDay: false,
    provider: 'apple',
    externalId: 'a-1',
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
        getCredentials: async () => ({ appleId: 'test@icloud.com', appPassword: 'pw' }),
        createTransport: () => ({
          pull: async () => ({ changes: [], syncToken: undefined }),
          pushCreate: async () => ({ externalId: 'a-new' }),
          pushUpdate,
          pushDelete: async () => undefined,
        }),
        ...overrides,
      },
    };
  }

  it('keeps local by pushing it to Apple', async () => {
    const { deps: d, pushUpdate } = deps();
    await resolveAppleConflict(d, { local, remote }, 'local');
    expect(pushUpdate).toHaveBeenCalledTimes(1);
    expect(pushUpdate).toHaveBeenCalledWith(local);
  });

  it('takes Apple by saving remote locally with source sync, keeping link and reminder', async () => {
    const { deps: d, saved, savedOptions } = deps();
    await resolveAppleConflict(d, { local, remote }, 'remote');
    expect(savedOptions()).toEqual({ source: 'sync' });
    expect(saved()![0]).toMatchObject({
      id: 'local-1',
      title: 'Remote title',
      provider: 'apple',
      externalId: 'a-1',
      link: { kind: 'note', path: 'Notes/Visit.md' },
      reminderMinutesBefore: 15,
    });
  });
});
