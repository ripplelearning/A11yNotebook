import { lstat, open, rename, rm, writeFile } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { VaultEntry } from '../../src/shared/types';

type Provenance = NonNullable<VaultEntry['provenance']>;
type RecordValue = { origin: Provenance; identity: string };
const identity = (stat: Stats) => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;

/** Identity is deliberately independent of mtime: ordinary external edits retain origin,
 * while replacement files are conservatively unknown. This is attribution, not authorization. */
export function createProvenanceStore(resolveMetadata: (name: string, missing?: boolean) => Promise<string>) {
  let records: Record<string, RecordValue> = Object.create(null);
  let writes: Promise<unknown> = Promise.resolve();

  async function initialize() {
    try {
      const filename = await resolveMetadata('provenance.json');
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return;
        const bytes = Buffer.alloc(4 * 1024 * 1024 + 1);
        let length = 0;
        while (length < bytes.length) {
          const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > 4 * 1024 * 1024) return;
        const raw: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        for (const [key, value] of Object.entries(raw)) {
          if (!value || typeof value !== 'object') continue;
          const record = value as RecordValue;
          if (['app-created', 'imported'].includes(record.origin) && typeof record.identity === 'string')
            records[key] = { origin: record.origin, identity: record.identity };
        }
      } finally {
        await file.close();
      }
    } catch {
      // Missing or damaged attribution must never confer trust.
      records = Object.create(null);
    }
  }

  function persist(assertCurrent: () => void = () => undefined) {
    const next = writes.then(async () => {
      assertCurrent();
      const filename = await resolveMetadata('provenance.json', true);
      const temporary = await resolveMetadata(`provenance-${randomUUID()}.tmp`, true);
      try {
        await writeFile(temporary, JSON.stringify(records), { flag: 'wx', mode: 0o600 });
        await resolveMetadata('provenance.json', true);
        assertCurrent();
        await rename(temporary, filename);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    });
    writes = next.catch(() => undefined);
    return next;
  }

  return {
    initialize,
    get(relative: string, stat: Stats): Provenance {
      const record = records[relative];
      return record?.identity === identity(stat) ? record.origin : 'unknown';
    },
    async record(
      relative: string,
      absolute: string,
      origin: Provenance,
      expected?: Stats,
      assertCurrent: () => void = () => undefined,
    ) {
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Only regular files have provenance.');
      if (
        expected &&
        (identity(stat) !== identity(expected) ||
          stat.size !== expected.size ||
          stat.mtimeMs !== expected.mtimeMs ||
          stat.ctimeMs !== expected.ctimeMs)
      )
        throw new Error('The note changed while authenticating its origin. Reopen it.');
      assertCurrent();
      const previous = records[relative];
      const record = { origin, identity: identity(stat) };
      records[relative] = record;
      try {
        await persist(assertCurrent);
      } catch (error) {
        if (records[relative] === record) {
          if (previous) records[relative] = previous;
          else delete records[relative];
        }
        throw error;
      }
    },
    async move(source: string, destination: string) {
      for (const key of Object.keys(records)) {
        if (key !== source && !key.startsWith(`${source}/`)) continue;
        records[`${destination}${key.slice(source.length)}`] = records[key];
        delete records[key];
      }
      await persist();
    },
    async remove(relative: string) {
      for (const key of Object.keys(records))
        if (key === relative || key.startsWith(`${relative}/`)) delete records[key];
      await persist();
    },
    async flush() {
      await writes;
    },
  };
}
