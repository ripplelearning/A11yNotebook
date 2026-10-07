// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_MAX_BYTES,
  AUDIT_MAX_ENTRIES,
  AUDIT_RETENTION_MS,
  createAuditStore,
  runAudited,
  type AuditOperation,
} from '../../electron/vault/audit';

const fault = vi.hoisted(() => ({ stage: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (String(args[0]).endsWith('pending-audit.json')) {
        if (fault.stage === 'write')
          vi.spyOn(file, 'writeFile').mockImplementation(async () => {
            await actual.writeFile(file, '{"version":');
            throw Object.assign(new Error('Disk full.'), { code: 'ENOSPC' });
          });
        if (fault.stage === 'sync') vi.spyOn(file, 'sync').mockRejectedValue(new Error('Flush failed.'));
      }
      return file;
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fault.stage === 'rename') throw new Error('Replacement failed.');
      return actual.rename(...args);
    },
  };
});

const clock = Date.parse('2026-10-07T12:00:00.000Z');
const entry = { operation: 'protection.lock', outcome: 'succeeded', time: new Date(clock).toISOString() };
let root: string;
let failCommit = false;
let destinationChecks = 0;
const resolver = {
  resolveMetadata: async (name: string) => {
    if (name === 'audit.json' && ++destinationChecks === 3 && failCommit)
      throw new Error('Simulated interruption before replacement.');
    return path.join(root, name);
  },
};
const saved = async () =>
  JSON.parse(await readFile(path.join(root, 'audit.json'), 'utf8')) as {
    version: number;
    entries: (typeof entry)[];
  };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'a11y-audit-'));
  failCommit = false;
  destinationChecks = 0;
  fault.stage = '';
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('bounded local audit schema', () => {
  it('stores only operation, outcome and time, even when excess arguments contain content', async () => {
    const store = createAuditStore(resolver, () => clock);
    const record = store.record as (...args: unknown[]) => Promise<unknown>;
    expect(
      await record('note.export', 'succeeded', { password: 'do-not-store', path: 'Private.md', body: 'quote' }),
    ).toEqual({ recorded: true });
    expect(await saved()).toEqual({ version: 1, entries: [{ ...entry, operation: 'note.export' }] });
    expect(await readFile(path.join(root, 'audit.json'), 'utf8')).not.toMatch(/do-not-store|Private|quote|password/);
  });

  it('rejects arbitrary events without creating a log', async () => {
    expect(await createAuditStore(resolver).record('secret' as AuditOperation, 'succeeded')).toEqual({
      recorded: false,
      reason: 'invalid-event',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    { version: 2, entries: [] },
    { version: 1, entries: [null] },
    { version: 1, entries: [{ ...entry, operation: 'arbitrary' }] },
    { version: 1, entries: [{ ...entry, outcome: 'unknown' }] },
    { version: 1, entries: [{ ...entry, time: '2026-02-30T12:00:00.000Z' }] },
    { version: 1, entries: [{ ...entry, body: 'private content' }] },
    { version: 1, entries: [], password: 'not-allowed' },
    { version: 1, entries: Array.from({ length: AUDIT_MAX_ENTRIES + 1 }, () => entry) },
  ])('rejects malformed entries and preserves the previous file (%#)', async (value) => {
    const before = JSON.stringify(value);
    await writeFile(path.join(root, 'audit.json'), before);
    expect(await createAuditStore(resolver, () => clock).record('protection.lock', 'succeeded')).toEqual({
      recorded: false,
      reason: 'storage-failure',
    });
    expect(await readFile(path.join(root, 'audit.json'), 'utf8')).toBe(before);
  });

  it('rejects truncated JSON and oversized files', async () => {
    for (const content of ['{"version":1,', ' '.repeat(AUDIT_MAX_BYTES + 1)]) {
      await writeFile(path.join(root, 'audit.json'), content);
      expect(await createAuditStore(resolver, () => clock).record('protection.lock', 'succeeded')).toEqual({
        recorded: false,
        reason: 'storage-failure',
      });
      expect(await readFile(path.join(root, 'audit.json'), 'utf8')).toBe(content);
    }
  });

  it('rejects a non-file before attempting to read it', async () => {
    await mkdir(path.join(root, 'audit.json'));
    expect(await createAuditStore(resolver, () => clock).record('protection.lock', 'succeeded')).toEqual({
      recorded: false,
      reason: 'storage-failure',
    });
    expect(await readdir(root)).toEqual(['audit.json']);
  });

  it('prunes old and future timestamps and retains only the newest 1000 entries', async () => {
    await writeFile(
      path.join(root, 'audit.json'),
      JSON.stringify({
        version: 1,
        entries: [
          { ...entry, time: new Date(clock - AUDIT_RETENTION_MS).toISOString() },
          { ...entry, time: new Date(clock + 1).toISOString() },
          entry,
        ],
      }),
    );
    const store = createAuditStore(resolver, () => clock);
    await store.record('protection.unlock', 'failed');
    expect((await saved()).entries).toEqual([entry, { ...entry, operation: 'protection.unlock', outcome: 'failed' }]);
    await writeFile(
      path.join(root, 'audit.json'),
      JSON.stringify({
        version: 1,
        entries: Array.from({ length: AUDIT_MAX_ENTRIES }, () => entry),
      }),
    );
    expect(await store.record('credentials.read', 'succeeded')).toEqual({ recorded: true });
    expect((await saved()).entries).toHaveLength(AUDIT_MAX_ENTRIES);
    expect((await saved()).entries.at(-1)?.operation).toBe('credentials.read');
  });

  it('serializes concurrent writes without dropping events', async () => {
    const store = createAuditStore(resolver, () => clock);
    await Promise.all(Array.from({ length: 30 }, () => store.record('credentials.read', 'succeeded')));
    expect((await saved()).entries).toHaveLength(30);
  });

  it('interruption before replacement leaves the prior log intact and removes its temporary file', async () => {
    const before = JSON.stringify({ version: 1, entries: [entry] });
    await writeFile(path.join(root, 'audit.json'), before);
    failCommit = true;
    expect(await createAuditStore(resolver, () => clock).record('note.encrypt', 'succeeded')).toEqual({
      recorded: false,
      reason: 'storage-failure',
    });
    expect(await readFile(path.join(root, 'audit.json'), 'utf8')).toBe(before);
    expect(await readdir(root)).toEqual(['audit.json']);
    failCommit = false;
    expect(await createAuditStore(resolver, () => clock).record('note.encrypt', 'succeeded')).toEqual({
      recorded: true,
    });
    expect((await saved()).entries).toHaveLength(2);
  });

  it('ignores a leftover partial temporary file after restart', async () => {
    await writeFile(path.join(root, 'pending-audit.json'), '{"version":1');
    expect(await createAuditStore(resolver, () => clock).record('note.export', 'cancelled')).toEqual({
      recorded: true,
    });
    expect((await saved()).entries).toEqual([{ ...entry, operation: 'note.export', outcome: 'cancelled' }]);
    expect(await readdir(root)).toEqual(['audit.json']);
  });

  it.each(['write', 'sync', 'rename'])(
    'keeps the committed log after a %s failure and permits retry',
    async (stage) => {
      const before = JSON.stringify({ version: 1, entries: [entry] });
      await writeFile(path.join(root, 'audit.json'), before);
      const store = createAuditStore(resolver, () => clock);
      fault.stage = stage;
      expect(await store.record('note.export', 'succeeded')).toEqual({ recorded: false, reason: 'storage-failure' });
      expect(await readFile(path.join(root, 'audit.json'), 'utf8')).toBe(before);
      expect(await readdir(root)).toEqual(['audit.json']);
      fault.stage = '';
      expect(await store.record('note.export', 'succeeded')).toEqual({ recorded: true });
      expect((await saved()).entries).toHaveLength(2);
    },
  );
});

describe('operation outcomes remain independent of storage failures', () => {
  it('preserves successful results and explicitly warns when logging fails', async () => {
    await writeFile(path.join(root, 'audit.json'), 'damaged');
    const warn = vi.fn(async () => undefined);
    expect(
      await runAudited(
        createAuditStore(resolver),
        'note.export',
        async (audit) => {
          audit.committed();
          return 'saved';
        },
        warn,
      ),
    ).toBe('saved');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('succeeded, but its audit entry could not be recorded'));
  });

  it('does not turn a rejected operation into success or log its error content', async () => {
    const failure = new Error('Secret document body');
    await expect(
      runAudited(
        createAuditStore(resolver, () => clock),
        'credentials.save',
        async () => {
          throw failure;
        },
        vi.fn(),
      ),
    ).rejects.toBe(failure);
    expect((await saved()).entries[0].outcome).toBe('failed');
    expect(await readFile(path.join(root, 'audit.json'), 'utf8')).not.toContain(failure.message);
  });

  it('distinguishes a commit followed by failure and warns without claiming rollback', async () => {
    await writeFile(path.join(root, 'audit.json'), 'damaged');
    const warn = vi.fn(async () => undefined);
    await expect(
      runAudited(
        createAuditStore(resolver),
        'recovery.commit',
        async (audit) => {
          audit.committed();
          throw new Error('Cleanup incomplete.');
        },
        warn,
      ),
    ).rejects.toThrow('operation committed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('operation committed'));
  });

  it('records committed-with-error and cancellation independently', async () => {
    const store = createAuditStore(resolver, () => clock);
    await expect(
      runAudited(
        store,
        'recovery.commit',
        async (audit) => {
          audit.committed();
          throw new Error('Cleanup incomplete.');
        },
        vi.fn(),
      ),
    ).rejects.toThrow('Cleanup incomplete');
    await runAudited(store, 'note.export', async (audit) => audit.cancelled(), vi.fn());
    expect((await saved()).entries.map((item) => item.outcome)).toEqual(['committed-with-error', 'cancelled']);
  });
});
