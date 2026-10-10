import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface MetadataResolver {
  resolveMetadata(name: string, allowMissing?: boolean): Promise<string>;
}

/** Serialize metadata operations and atomically replace JSON, never following symlinks. */
export function createMetadataStore(service: MetadataResolver) {
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  };
  return {
    read: (name: string): Promise<unknown> =>
      serialize(async () => {
        try {
          return JSON.parse(await readFile(await service.resolveMetadata(name), 'utf8')) as unknown;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }),
    write: (name: string, value: unknown, assertCurrent?: () => void): Promise<void> =>
      serialize(async () => {
        assertCurrent?.();
        const destination = await service.resolveMetadata(name, true);
        const temporary = await service.resolveMetadata(`pending-${randomUUID()}.json`, true);
        try {
          await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
          await service.resolveMetadata(name, true);
          assertCurrent?.();
          await rename(temporary, destination);
          assertCurrent?.();
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      }),
  };
}
