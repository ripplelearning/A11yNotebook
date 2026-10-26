import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import {
  applySync,
  classifyRemote,
  cleanSyncState,
  localChangesSince,
  pruneTombstones,
  sameAppointmentContent,
  stampForSync,
  type SyncStateFile,
} from '../shared/calendar-sync';
import type { CalendarAppointment } from '../shared/calendar';

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'local-1',
    title: 'Checkup',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    ...overrides,
  };
}

describe('calendar sync core', () => {
  it('stamps updatedAt while preserving id and sync links', () => {
    const stamped = stampForSync(
      appointment({ provider: 'google', externalId: 'evt-1' }),
      '2026-10-26T18:00:00.000Z',
    );
    expect(stamped.id).toBe('local-1');
    expect(stamped.provider).toBe('google');
    expect(stamped.externalId).toBe('evt-1');
    expect(stamped.updatedAt).toBe('2026-10-26T18:00:00.000Z');
  });

  it('treats everything as changed on first sync and only newer items after', () => {
    const items = [
      appointment({ id: 'a', updatedAt: '2026-10-20T00:00:00.000Z' }),
      appointment({ id: 'b', updatedAt: '2026-10-27T00:00:00.000Z' }),
      appointment({ id: 'c' }),
    ];
    expect(localChangesSince(items)).toHaveLength(3);
    const changed = localChangesSince(items, '2026-10-26T00:00:00.000Z').map((item) => item.id);
    expect(changed).toEqual(['b', 'c']);
  });

  it('classifies remote items by external id and reports real conflicts only', () => {
    const local = [
      appointment({ id: 'l1', provider: 'google', externalId: 'evt-1', updatedAt: '2026-10-25T00:00:00.000Z' }),
      appointment({ id: 'l2', provider: 'google', externalId: 'evt-2', updatedAt: '2026-10-25T00:00:00.000Z' }),
      appointment({ id: 'l3', provider: 'google', externalId: 'evt-3', updatedAt: '2026-10-27T00:00:00.000Z' }),
    ];
    const remote = [
      appointment({ provider: 'google', externalId: 'evt-1', updatedAt: '2026-10-27T00:00:00.000Z', title: 'Checkup moved' }),
      appointment({ provider: 'google', externalId: 'evt-2', updatedAt: '2026-10-25T00:00:00.000Z' }),
      appointment({ provider: 'google', externalId: 'evt-3', updatedAt: '2026-10-27T00:00:00.000Z', title: 'Changed remotely too' }),
      appointment({ provider: 'google', externalId: 'evt-9', updatedAt: '2026-10-27T00:00:00.000Z', title: 'Brand new' }),
    ];
    const classified = classifyRemote(remote, local, 'google', '2026-10-26T00:00:00.000Z');
    expect(classified.map((entry) => entry.classification)).toEqual([
      'remoteWins',
      'unchanged',
      'conflict',
      'remoteOnly',
    ]);
  });

  it('does not call identical content a conflict when both sides were re-stamped', () => {
    const local = [appointment({ id: 'l1', provider: 'google', externalId: 'evt-1', updatedAt: '2026-10-27T00:00:00.000Z' })];
    const remote = [appointment({ provider: 'google', externalId: 'evt-1', updatedAt: '2026-10-27T00:00:00.000Z' })];
    const [entry] = classifyRemote(remote, local, 'google', '2026-10-26T00:00:00.000Z');
    expect(entry.classification).toBe('unchanged');
  });

  it('applies remote changes, keeps local ids, and leaves conflicts untouched', () => {
    const local = [
      appointment({ id: 'l1', provider: 'google', externalId: 'evt-1', updatedAt: '2026-10-25T00:00:00.000Z' }),
      appointment({ id: 'l3', provider: 'google', externalId: 'evt-3', updatedAt: '2026-10-27T00:00:00.000Z' }),
    ];
    const remote = [
      appointment({ provider: 'google', externalId: 'evt-1', updatedAt: '2026-10-27T00:00:00.000Z', title: 'Moved' }),
      appointment({ provider: 'google', externalId: 'evt-3', updatedAt: '2026-10-27T00:00:00.000Z', title: 'Remote edit' }),
      appointment({ provider: 'google', externalId: 'evt-9', updatedAt: '2026-10-27T00:00:00.000Z', title: 'New' }),
    ];
    const classified = classifyRemote(remote, local, 'google', '2026-10-26T00:00:00.000Z');
    const { merged, conflicts } = applySync(local, classified);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.id).toBe('l3');
    expect(merged.find((item) => item.id === 'l1')?.title).toBe('Moved');
    expect(merged.find((item) => item.id === 'l3')?.title).toBe('Checkup');
    const added = merged.find((item) => item.externalId === 'evt-9');
    expect(added).toBeDefined();
    expect(added!.id).not.toBe('evt-9');
    expect(added!.provider).toBe('google');
  });

  it('validates sync state, dropping malformed providers and tombstones', () => {
    const cleaned = cleanSyncState({
      version: 1,
      providers: {
        google: { provider: 'google', lastSyncAt: '2026-10-26T00:00:00.000Z', syncToken: 'tok' },
        outlook: { provider: 'outlook', lastSyncAt: 'not-a-date' },
        bogus: { provider: 'bogus' },
      },
      tombstones: [
        { id: 'gone-1', deletedAt: '2026-10-26T00:00:00.000Z' },
        { id: '', deletedAt: '2026-10-26T00:00:00.000Z' },
        { id: 'gone-1', deletedAt: '2026-10-26T00:00:00.000Z' },
      ],
    } as unknown as SyncStateFile);
    expect(cleaned.providers.google?.syncToken).toBe('tok');
    expect(cleaned.providers.outlook?.lastSyncAt).toBeUndefined();
    expect(cleaned.providers).not.toHaveProperty('bogus');
    expect(cleaned.tombstones).toEqual([{ id: 'gone-1', deletedAt: '2026-10-26T00:00:00.000Z' }]);
  });

  it('persists sync state and cleans it on save and read', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-calendar-sync-'));
    try {
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      expect(await service.getSyncState()).toEqual({ version: 1, providers: {}, tombstones: [] });
      const saved = await service.saveSyncState({
        version: 1,
        providers: {
          google: { provider: 'google', lastSyncAt: '2026-10-26T00:00:00.000Z', syncToken: 'tok' },
        },
        tombstones: [{ id: 'gone-1', deletedAt: '2026-10-26T00:00:00.000Z' }],
      });
      expect(saved.providers.google?.syncToken).toBe('tok');
      expect(await service.getSyncState()).toEqual(saved);
      expect(await service.saveSyncState({ version: 1, providers: {}, tombstones: [] })).toEqual({
        version: 1,
        providers: {},
        tombstones: [],
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('stamps new and changed appointments but preserves unchanged stamps', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-calendar-sync-'));
    try {
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      const old = '2026-01-01T00:00:00.000Z';
      await service.saveCalendar([appointment({ id: 'a', updatedAt: old })], { source: 'sync' });
      const [kept] = await service.saveCalendar([appointment({ id: 'a' })]);
      expect(kept.updatedAt).toBe(old);
      const [changed] = await service.saveCalendar([appointment({ id: 'a', title: 'Changed' })]);
      expect(changed.updatedAt).not.toBe(old);
      expect(changed.title).toBe('Changed');
      const [created] = await service.saveCalendar([
        appointment({ id: 'a', title: 'Changed' }),
        appointment({ id: 'b', title: 'New' }),
      ]);
      expect(created.updatedAt).not.toBe(old);
      const stored = await service.getCalendar();
      expect(stored.find((item) => item.id === 'b')?.updatedAt).toBeTruthy();
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('records deletions as tombstones and prunes them when re-added', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-calendar-sync-'));
    try {
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      await service.saveCalendar([appointment({ id: 'a' }), appointment({ id: 'b' })]);
      await service.saveCalendar([appointment({ id: 'a' })]);
      expect((await service.getSyncState()).tombstones.map((tombstone) => tombstone.id)).toEqual(['b']);
      await service.saveCalendar([appointment({ id: 'a' }), appointment({ id: 'b' })]);
      expect((await service.getSyncState()).tombstones).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('leaves sync-applied saves unstamped and untombstoned', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-calendar-sync-'));
    try {
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      const stamp = '2026-01-02T00:00:00.000Z';
      await service.saveCalendar([appointment({ id: 'a' }), appointment({ id: 'b' })]);
      await service.saveCalendar([appointment({ id: 'a', updatedAt: stamp })], { source: 'sync' });
      expect((await service.getCalendar()).find((item) => item.id === 'a')?.updatedAt).toBe(stamp);
      expect((await service.getSyncState()).tombstones).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('prunes tombstones for appointments that exist locally again', () => {
    const pruned = pruneTombstones(
      [
        { id: 'gone-1', deletedAt: '2026-10-26T00:00:00.000Z' },
        { id: 'back-2', deletedAt: '2026-10-26T00:00:00.000Z' },
      ],
      [appointment({ id: 'back-2' })],
    );
    expect(pruned.map((tombstone) => tombstone.id)).toEqual(['gone-1']);
  });

  it('ignores link-only differences when comparing content', () => {
    const plain = appointment();
    const linked = appointment({ link: { kind: 'note', path: 'Notes/Visit.md' } });
    expect(sameAppointmentContent(plain, linked)).toBe(true);
  });

  it('ignores reminder-only differences when comparing content', () => {
    const plain = appointment();
    const reminded = appointment({ reminderMinutesBefore: 15 });
    expect(sameAppointmentContent(plain, reminded)).toBe(true);
  });

  it('keeps the local reminder when remote content wins', () => {
    const local = appointment({
      id: 'local-9',
      provider: 'google',
      externalId: 'g-9',
      reminderMinutesBefore: 30,
    });
    const { merged } = applySync([local], [
      {
        remote: appointment({ title: 'Changed', provider: 'google', externalId: 'g-9' }),
        local,
        classification: 'remoteWins',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Changed');
    expect(merged[0].reminderMinutesBefore).toBe(30);
  });

  it('keeps the local link when remote content wins', () => {
    const local = appointment({
      id: 'local-9',
      provider: 'google',
      externalId: 'g-9',
      link: { kind: 'note', path: 'Notes/Visit.md' },
    });
    const { merged } = applySync([local], [
      {
        remote: appointment({ title: 'Changed', provider: 'google', externalId: 'g-9' }),
        local,
        classification: 'remoteWins',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('local-9');
    expect(merged[0].title).toBe('Changed');
    expect(merged[0].link).toEqual({ kind: 'note', path: 'Notes/Visit.md' });
  });

  it('keeps provider and external id on tombstones and drops invalid ones', () => {
    const cleaned = cleanSyncState({
      version: 1,
      providers: {},
      tombstones: [
        {
          id: 'gone-1',
          deletedAt: '2026-10-26T00:00:00.000Z',
          provider: 'google',
          externalId: 'g-1',
        },
        {
          id: 'gone-2',
          deletedAt: '2026-10-26T00:00:00.000Z',
          provider: 'bogus',
          externalId: 'g-2',
        },
      ],
    } as unknown as SyncStateFile);
    expect(cleaned.tombstones).toEqual([
      { id: 'gone-1', deletedAt: '2026-10-26T00:00:00.000Z', provider: 'google', externalId: 'g-1' },
      { id: 'gone-2', deletedAt: '2026-10-26T00:00:00.000Z', externalId: 'g-2' },
    ]);
  });

  it('does not restamp a link-only edit', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-calendar-sync-'));
    try {
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      const stamp = '2026-01-02T00:00:00.000Z';
      await service.saveCalendar([appointment({ id: 'a', updatedAt: stamp })], { source: 'sync' });
      const [kept] = await service.saveCalendar([
        appointment({ id: 'a', link: { kind: 'note', path: 'Notes/Visit.md' } }),
      ]);
      expect(kept.updatedAt).toBe(stamp);
      expect(kept.link).toEqual({ kind: 'note', path: 'Notes/Visit.md' });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('records provider and external id on deletion tombstones', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-calendar-sync-'));
    try {
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      await service.saveCalendar([
        appointment({ id: 'a', provider: 'google', externalId: 'g-1' }),
      ]);
      await service.saveCalendar([]);
      expect((await service.getSyncState()).tombstones).toEqual([
        expect.objectContaining({ id: 'a', provider: 'google', externalId: 'g-1' }),
      ]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
