import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { createMetadataStore, type MetadataResolver } from './metadata';
import { readBoundedMetadata } from './metadata-protection';

export type Provenance = 'created' | 'imported';
const filename = 'provenance.json';
type Records = Record<string, Provenance>;

async function identity(filename: string) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.ino <= 0 || stat.birthtimeMs <= 0) return null;
  return createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`).digest('hex');
}

/** No note contents, filenames, or original source locations are kept in this sidecar.
 * Explicit operation records establish origin, never filesystem timestamps.
 * Identity only prevents a deleted file's successor inheriting a previous record.
 */
export function createProvenanceStore(resolver: MetadataResolver, liveIdentities?: () => Promise<Set<string>>) {
  const metadata = createMetadataStore(resolver);
  let pending: Promise<unknown> = Promise.resolve();
  let nextPruneAt = 1024;
  function serialize<T>(operation: () => Promise<T>) {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }
  async function snapshot(strict = false): Promise<Records> {
    try {
      const raw: unknown = JSON.parse(
        await readBoundedMetadata(await resolver.resolveMetadata(filename), 8 * 1024 * 1024),
      );
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid document origin metadata.');
      const envelope = raw as { version?: unknown; records?: unknown };
      if (
        envelope.version !== 1 ||
        !envelope.records ||
        typeof envelope.records !== 'object' ||
        Array.isArray(envelope.records)
      )
        throw new Error('Invalid document origin metadata version or records.');
      const entries = Object.entries(envelope.records);
      if (
        entries.length > 100_000 ||
        entries.some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || !['created', 'imported'].includes(value))
      )
        throw new Error('Document origin metadata exceeds its limit or contains invalid records.');
      return Object.fromEntries(entries) as Records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      if (strict)
        throw new Error(
          'Document origin metadata could not be safely read. Restore or repair the sidecar before changing managed files.',
        );
      // Origin hints must never make an otherwise readable library unavailable.
      return {};
    }
  }
  async function get(absolute: string, records?: Records, strict = false): Promise<Provenance | undefined> {
    const key = await identity(absolute);
    return key ? (records ?? (await snapshot(strict)))[key] : undefined;
  }
  function record(absolute: string, origin: Provenance, assertCurrent?: () => void, expectedIdentity?: string) {
    return serialize(async () => {
      if (origin !== 'created' && origin !== 'imported') throw new Error('Invalid document origin.');
      const key = await identity(absolute);
      if (expectedIdentity && key !== expectedIdentity)
        throw new Error('The selected file changed. Retry the operation.');
      if (!key) return;
      let records = await snapshot(true);
      if (liveIdentities && Object.keys(records).length >= nextPruneAt) {
        const live = await liveIdentities();
        records = Object.fromEntries(Object.entries(records).filter(([id]) => live.has(id)));
        nextPruneAt = Math.min(100_000, Math.max(1024, Object.keys(records).length * 2));
      }
      if (!records[key] && Object.keys(records).length >= 100_000)
        throw new Error('Library origin metadata is full. No document was created.');
      records[key] = origin;
      if (Buffer.byteLength(JSON.stringify({ version: 1, records }, null, 2), 'utf8') > 8 * 1024 * 1024)
        throw new Error('Library origin metadata exceeds its size limit. No document was created.');
      assertCurrent?.();
      await metadata.write(filename, { version: 1, records }, assertCurrent);
    });
  }
  function forget(keys: string[], assertCurrent?: () => void) {
    if (!keys.length) return Promise.resolve();
    return serialize(async () => {
      const records = await snapshot(true);
      if (!keys.some((key) => key in records)) return;
      keys.forEach((key) => delete records[key]);
      await metadata.write(filename, { version: 1, records }, assertCurrent);
    });
  }
  function prune(assertCurrent?: () => void) {
    return serialize(async () => {
      if (!liveIdentities) return;
      const records = await snapshot(true);
      const live = await liveIdentities();
      const retained = Object.fromEntries(Object.entries(records).filter(([key]) => live.has(key)));
      if (Object.keys(retained).length !== Object.keys(records).length)
        await metadata.write(filename, { version: 1, records: retained }, assertCurrent);
    });
  }
  return { snapshot, get, record, identity, forget, prune };
}
