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
        const payload = JSON.stringify(value, null, 2);
        // Replacing the sidecar file is a rename over the previous copy.
        // On Windows that rename can be refused for a moment while
        // another process holds the file open, so a single refusal must
        // not fail the write: retry it briefly with a fresh staging
        // file each time. Only lock errors are retried; anything else —
        // including a changed library, via assertCurrent — fails at once.
        const isLockError = (error: unknown) =>
          ['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '');
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          const temporary = await service.resolveMetadata(`pending-${randomUUID()}.json`, true);
          try {
            await writeFile(temporary, payload, { flag: 'wx', mode: 0o600 });
            await service.resolveMetadata(name, true);
            assertCurrent?.();
            await rename(temporary, destination);
            assertCurrent?.();
            return;
          } catch (error) {
            lastError = error;
            if (!isLockError(error) || attempt === 2) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          } finally {
            await unlink(temporary).catch(() => undefined);
          }
        }
        throw lastError;
      }),
  };
}
