import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { createMetadataStore, type MetadataResolver } from './metadata';
import { readBoundedMetadata } from './metadata-protection';

const filename = 'protection.json';
type Records = Record<string, true>;

/**
 * File identity, shared with the origin records: device, inode, and creation
 * time. A rename or a move inside the library keeps the identity, so
 * protection follows the item; a replacement file gets a new identity and
 * does not inherit protection. Directories use the same identity, so
 * protecting a notebook also covers moving, renaming, or deleting it.
 */
async function identity(filename: string) {
  const stat = await lstat(filename);
  if (stat.isSymbolicLink() || stat.ino <= 0 || stat.birthtimeMs <= 0) return null;
  if (!stat.isFile() && !stat.isDirectory()) return null;
  return createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`).digest('hex');
}

/** Protection records attribute explicit operations, never authorize content. */
export function createProtectionStore(resolver: MetadataResolver, liveIdentities?: () => Promise<Set<string>>) {
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
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid item protection metadata.');
      const envelope = raw as { version?: unknown; records?: unknown };
      if (
        envelope.version !== 1 ||
        !envelope.records ||
        typeof envelope.records !== 'object' ||
        Array.isArray(envelope.records)
      )
        throw new Error('Invalid item protection metadata version or records.');
      const entries = Object.entries(envelope.records);
      if (
        entries.length > 100_000 ||
        entries.some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || value !== true)
      )
        throw new Error('Item protection metadata exceeds its limit or contains invalid records.');
      return Object.fromEntries(entries) as Records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      if (strict)
        throw new Error(
          'Item protection metadata could not be safely read. Restore or repair the sidecar before changing protected items.',
        );
      return {};
    }
  }
  async function get(absolute: string, records?: Records): Promise<boolean> {
    const key = await identity(absolute);
    return key ? Boolean((records ?? (await snapshot()))[key]) : false;
  }
  function set(absolute: string, value: boolean, assertCurrent?: () => void) {
    return serialize(async () => {
      const key = await identity(absolute);
      if (!key) return;
      let records = await snapshot(true);
      if (liveIdentities && Object.keys(records).length >= nextPruneAt) {
        const live = await liveIdentities();
        records = Object.fromEntries(Object.entries(records).filter(([id]) => live.has(id))) as Records;
        nextPruneAt = Math.min(100_000, Math.max(1024, Object.keys(records).length * 2));
      }
      if (value) {
        if (!records[key] && Object.keys(records).length >= 100_000)
          throw new Error('Library protection metadata is full. No item was protected.');
        records[key] = true;
      } else {
        delete records[key];
      }
      if (Buffer.byteLength(JSON.stringify({ version: 1, records }, null, 2), 'utf8') > 8 * 1024 * 1024)
        throw new Error('Library protection metadata exceeds its size limit. No item was protected.');
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
      const retained = Object.fromEntries(Object.entries(records).filter(([id]) => live.has(id))) as Records;
      if (Object.keys(retained).length !== Object.keys(records).length)
        await metadata.write(filename, { version: 1, records: retained }, assertCurrent);
    });
  }
  return { snapshot, get, set, forget, prune, identity, flush: () => pending };
}
