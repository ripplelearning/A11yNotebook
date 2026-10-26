import { describe, expect, it } from 'vitest';
import { runSync, SyncTokenExpiredError, type ProviderTransport, type PulledChange } from '../shared/calendar-sync-engine';
import type { SyncStateFile } from '../shared/calendar-sync';
import type { AppointmentInput, CalendarAppointment } from '../shared/calendar';

const NOW = '2026-10-26T12:00:00.000Z';
const LAST_SYNC = '2026-10-20T00:00:00.000Z';
const OLD = '2026-10-01T00:00:00.000Z';
const NEW = '2026-10-25T00:00:00.000Z';

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'local-1',
    title: 'Checkup',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    ...overrides,
  };
}

function remote(overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return {
    title: 'Checkup',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    provider: 'google',
    externalId: 'g-1',
    updatedAt: NEW,
    ...overrides,
  };
}

interface Harness {
  deps: Parameters<typeof runSync>[0];
  calls: { creates: CalendarAppointment[]; updates: CalendarAppointment[]; deletes: string[]; pulls: Array<string | undefined> };
  savedLocal: CalendarAppointment[] | null;
  savedState: SyncStateFile | null;
}

function harness(options: {
  local?: CalendarAppointment[];
  state?: SyncStateFile;
  pull?: (token: string | undefined) => Promise<{ changes: PulledChange[]; syncToken?: string }>;
}): Harness {
  const calls: Harness['calls'] = { creates: [], updates: [], deletes: [], pulls: [] };
  let savedLocal: CalendarAppointment[] | null = null;
  let savedState: SyncStateFile | null = null;
  const transport: ProviderTransport = {
    pull: async (token) => {
      calls.pulls.push(token);
      return options.pull
        ? options.pull(token)
        : { changes: [], syncToken: 'tok-new' };
    },
    pushCreate: async (item) => {
      calls.creates.push(item);
      return { externalId: 'g-created', updatedAt: '2027-01-01T00:00:00.000Z' };
    },
    pushUpdate: async (item) => {
      calls.updates.push(item);
      return { updatedAt: '2027-01-01T00:00:00.000Z' };
    },
    pushDelete: async (id) => {
      calls.deletes.push(id);
    },
  };
  const deps: Harness['deps'] = {
    provider: 'google',
    loadLocal: async () => options.local ?? [],
    loadState: async () =>
      options.state ?? { version: 1, providers: {}, tombstones: [] },
    saveLocal: async (items, opts) => {
      expect(opts).toEqual({ source: 'sync' });
      savedLocal = items;
      return items;
    },
    saveState: async (state) => {
      savedState = state;
      return state;
    },
    transport,
    nowIso: NOW,
  };
  return {
    deps,
    calls,
    get savedLocal() {
      return savedLocal;
    },
    get savedState() {
      return savedState;
    },
  };
}

describe('calendar sync engine', () => {
  it('inserts remote-only events with fresh local ids', async () => {
    const h = harness({
      pull: async () => ({ changes: [{ kind: 'upsert', appointment: remote() }], syncToken: 'tok-2' }),
    });
    const result = await runSync(h.deps);
    expect(result).toMatchObject({ pulled: 1, pushed: 0, deleted: 0, syncToken: 'tok-2' });
    expect(result.conflicts).toEqual([]);
    expect(h.savedLocal).toHaveLength(1);
    expect(h.savedLocal![0].id).not.toBe('');
    expect(h.savedLocal![0]).toMatchObject({ provider: 'google', externalId: 'g-1' });
    expect(h.savedState!.providers.google).toEqual({
      provider: 'google',
      lastSyncAt: NOW,
      syncToken: 'tok-2',
    });
  });

  it('applies remote wins and keeps the local link', async () => {
    const local = appointment({
      provider: 'google',
      externalId: 'g-1',
      updatedAt: OLD,
      link: { kind: 'note', path: 'Notes/Visit.md' },
    });
    const h = harness({
      local: [local],
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      },
      pull: async () => ({
        changes: [{ kind: 'upsert', appointment: remote({ title: 'Changed' }) }],
        syncToken: 'tok-2',
      }),
    });
    const result = await runSync(h.deps);
    expect(result.conflicts).toEqual([]);
    expect(h.savedLocal).toHaveLength(1);
    expect(h.savedLocal![0]).toMatchObject({
      id: 'local-1',
      title: 'Changed',
      link: { kind: 'note', path: 'Notes/Visit.md' },
    });
  });

  it('leaves conflicts untouched and never pushes them', async () => {
    const local = appointment({ provider: 'google', externalId: 'g-1', updatedAt: NEW });
    const h = harness({
      local: [local],
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      },
      pull: async () => ({
        changes: [{ kind: 'upsert', appointment: remote({ title: 'Remote title' }) }],
        syncToken: 'tok-2',
      }),
    });
    const result = await runSync(h.deps);
    expect(result.conflicts).toHaveLength(1);
    expect(result.pushed).toBe(0);
    expect(h.savedLocal![0].title).toBe('Checkup');
  });

  it('does not call identical content a conflict when both sides changed', async () => {
    const local = appointment({ provider: 'google', externalId: 'g-1', updatedAt: NEW });
    const h = harness({
      local: [local],
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      },
      pull: async () => ({
        changes: [{ kind: 'upsert', appointment: remote() }],
        syncToken: 'tok-2',
      }),
    });
    const result = await runSync(h.deps);
    expect(result.conflicts).toEqual([]);
    expect(result.pushed).toBe(0);
  });

  it('removes remotely deleted appointments without tombstoning them', async () => {
    const local = appointment({ provider: 'google', externalId: 'g-1', updatedAt: OLD });
    const h = harness({
      local: [local],
      pull: async () => ({ changes: [{ kind: 'deleted', externalId: 'g-1' }], syncToken: 'tok-2' }),
    });
    const result = await runSync(h.deps);
    expect(result.deleted).toBe(1);
    expect(h.savedLocal).toEqual([]);
    expect(h.savedState!.tombstones).toEqual([]);
  });

  it('creates local-only appointments and attaches the external id', async () => {
    const local = appointment({ updatedAt: NEW });
    const h = harness({
      local: [local],
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      },
    });
    const result = await runSync(h.deps);
    expect(result.pushed).toBe(1);
    expect(h.calls.creates).toHaveLength(1);
    expect(h.savedLocal![0]).toMatchObject({
      externalId: 'g-created',
      provider: 'google',
      updatedAt: NEW,
    });
  });

  it('updates changed linked appointments instead of recreating them', async () => {
    const local = appointment({ provider: 'google', externalId: 'g-1', updatedAt: NEW });
    const h = harness({
      local: [local],
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      },
    });
    const result = await runSync(h.deps);
    expect(result.pushed).toBe(1);
    expect(h.calls.updates).toHaveLength(1);
    expect(h.calls.creates).toHaveLength(0);
  });

  it('does not push link-only edits', async () => {
    const local = appointment({
      provider: 'google',
      externalId: 'g-1',
      updatedAt: OLD,
      link: { kind: 'note', path: 'Notes/Visit.md' },
    });
    const h = harness({
      local: [local],
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      },
    });
    const result = await runSync(h.deps);
    expect(result.pushed).toBe(0);
    expect(h.calls.creates).toHaveLength(0);
    expect(h.calls.updates).toHaveLength(0);
  });

  it('executes provider tombstone deletes and keeps other providers', async () => {
    const h = harness({
      state: {
        version: 1,
        providers: {},
        tombstones: [
          { id: 'gone-1', deletedAt: OLD, provider: 'google', externalId: 'g-9' },
          { id: 'gone-2', deletedAt: OLD, provider: 'google' },
          { id: 'gone-3', deletedAt: OLD, provider: 'outlook', externalId: 'o-3' },
        ],
      },
    });
    const result = await runSync(h.deps);
    expect(result.deleted).toBe(1);
    expect(h.calls.deletes).toEqual(['g-9']);
    expect(h.savedState!.tombstones).toEqual([
      { id: 'gone-3', deletedAt: OLD, provider: 'outlook', externalId: 'o-3' },
    ]);
  });

  it('retries once as a full pull when the token expires', async () => {
    const h = harness({
      state: {
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC, syncToken: 'tok-old' } },
        tombstones: [],
      },
      pull: async (token) => {
        if (token === 'tok-old') throw new SyncTokenExpiredError();
        return { changes: [], syncToken: 'tok-fresh' };
      },
    });
    const result = await runSync(h.deps);
    expect(h.calls.pulls).toEqual(['tok-old', undefined]);
    expect(result.syncToken).toBe('tok-fresh');
    expect(h.savedState!.providers.google?.syncToken).toBe('tok-fresh');
  });

  it('lets a pending local delete win over a remote upsert', async () => {
    const h = harness({
      state: {
        version: 1,
        providers: {},
        tombstones: [{ id: 'gone-1', deletedAt: OLD, provider: 'google', externalId: 'g-1' }],
      },
      pull: async () => ({ changes: [{ kind: 'upsert', appointment: remote() }], syncToken: 'tok-2' }),
    });
    const result = await runSync(h.deps);
    expect(h.savedLocal).toEqual([]);
    expect(h.calls.deletes).toEqual(['g-1']);
    expect(result.deleted).toBe(1);
  });

  it('does not save anything when a push fails', async () => {
    const transport: ProviderTransport = {
      pull: async () => ({ changes: [], syncToken: 'tok-2' }),
      pushCreate: async () => {
        throw new Error('Network down');
      },
      pushUpdate: async () => ({}),
      pushDelete: async () => undefined,
    };
    let saved = false;
    const deps: Parameters<typeof runSync>[0] = {
      provider: 'google',
      loadLocal: async () => [appointment({ updatedAt: NEW })],
      loadState: async () => ({
        version: 1,
        providers: { google: { provider: 'google', lastSyncAt: LAST_SYNC } },
        tombstones: [],
      }),
      saveLocal: async (items) => {
        saved = true;
        return items;
      },
      saveState: async (state) => state,
      transport,
      nowIso: NOW,
    };
    await expect(runSync(deps)).rejects.toThrow('Network down');
    expect(saved).toBe(false);
  });
});
