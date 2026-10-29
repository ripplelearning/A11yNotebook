import { createMetadataStore, type MetadataResolver } from './metadata';
import { readBoundedMetadata } from './metadata-protection';

/**
 * Records which library files have been superseded by a managed copy made
 * from them. A superseded original stays on disk; the library views hide
 * it unless the user turns "Show original files" on. The record is keyed
 * by file identity, so renaming or moving either file keeps the link,
 * and deleting the copy drops the record on the next scan, which makes
 * the original visible again.
 */
export interface SupersededRecord {
  /** Identity of the managed copy made from the original. */
  copy: string;
  /** Library-relative path of the copy when the record was made. */
  path: string;
}

type Records = Record<string, SupersededRecord>;

const filename = 'superseded.json';
const HEX_64 = /^[a-f0-9]{64}$/;

export function createSupersededStore(
  resolver: MetadataResolver,
  identity: (absolute: string) => Promise<string | null>,
) {
  const metadata = createMetadataStore(resolver);
  let pending: Promise<unknown> = Promise.resolve();

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
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid superseded metadata.');
      const envelope = raw as { version?: unknown; records?: unknown };
      if (
        envelope.version !== 1 ||
        !envelope.records ||
        typeof envelope.records !== 'object' ||
        Array.isArray(envelope.records)
      )
        throw new Error('Invalid superseded metadata version or records.');
      const entries = Object.entries(envelope.records);
      if (
        entries.length > 100_000 ||
        entries.some(
          ([key, value]) =>
            !HEX_64.test(key) ||
            !value ||
            typeof value !== 'object' ||
            !HEX_64.test((value as SupersededRecord).copy ?? '') ||
            typeof (value as SupersededRecord).path !== 'string',
        )
      )
        throw new Error('Superseded metadata exceeds its limit or contains invalid records.');
      return Object.fromEntries(entries) as Records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      if (strict)
        throw new Error(
          'Superseded metadata could not be safely read. Restore or repair the sidecar before changing managed files.',
        );
      return {};
    }
  }

  async function isSuperseded(absolute: string, records?: Records): Promise<boolean> {
    const key = await identity(absolute);
    return !!key && key in (records ?? (await snapshot()));
  }

  function record(
    sourceAbsolute: string,
    copyAbsolute: string,
    copyRelative: string,
    assertCurrent?: () => void,
  ) {
    return serialize(async () => {
      const sourceKey = await identity(sourceAbsolute);
      const copyKey = await identity(copyAbsolute);
      if (!sourceKey || !copyKey) return;
      const records = await snapshot(true);
      if (Object.keys(records).length >= 100_000 && !(sourceKey in records))
        throw new Error('Superseded metadata is full. No record was made.');
      records[sourceKey] = { copy: copyKey, path: copyRelative };
      if (Buffer.byteLength(JSON.stringify({ version: 1, records }, null, 2), 'utf8') > 8 * 1024 * 1024)
        throw new Error('Superseded metadata exceeds its size limit. No record was made.');
      assertCurrent?.();
      await metadata.write(filename, { version: 1, records }, assertCurrent);
    });
  }

  /** Drop records whose original or copy no longer exists in the library. Returns true when anything was dropped. */
  function prune(live: Set<string>, assertCurrent?: () => void) {
    return serialize(async () => {
      const records = await snapshot(true);
      const kept = Object.fromEntries(
        Object.entries(records).filter(([source, record]) => live.has(source) && live.has(record.copy)),
      );
      if (Object.keys(kept).length === Object.keys(records).length) return false;
      assertCurrent?.();
      await metadata.write(filename, { version: 1, records: kept }, assertCurrent);
      return true;
    });
  }

  return { snapshot, isSuperseded, record, prune };
}
