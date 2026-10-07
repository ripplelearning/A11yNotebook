import { open, rename, unlink } from 'node:fs/promises';
import type { MetadataResolver } from './metadata';

export const AUDIT_OPERATIONS = [
  'protection.setup',
  'protection.unlock',
  'protection.lock',
  'recovery.prepare',
  'recovery.commit',
  'recovery.reset-password',
  'recovery.revoke',
  'note.encrypt',
  'credentials.read',
  'credentials.save',
  'credentials.delete',
  'note.export',
] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];
export const AUDIT_OUTCOMES = ['succeeded', 'failed', 'cancelled', 'committed-with-error'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export const AUDIT_MAX_BYTES = 256 * 1024;
export const AUDIT_MAX_ENTRIES = 1000;
export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

interface AuditEntry {
  operation: AuditOperation;
  outcome: AuditOutcome;
  time: string;
}
export type AuditWriteResult = { recorded: true } | { recorded: false; reason: 'invalid-event' | 'storage-failure' };

function validEntry(value: unknown): value is AuditEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).sort().join(',') === 'operation,outcome,time' &&
    AUDIT_OPERATIONS.includes(entry.operation as AuditOperation) &&
    AUDIT_OUTCOMES.includes(entry.outcome as AuditOutcome) &&
    typeof entry.time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.time) &&
    Number.isFinite(Date.parse(entry.time)) &&
    new Date(entry.time).toISOString() === entry.time
  );
}

function validateLog(value: unknown): AuditEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid audit log.');
  const log = value as Record<string, unknown>;
  if (
    Object.keys(log).sort().join(',') !== 'entries,version' ||
    log.version !== 1 ||
    !Array.isArray(log.entries) ||
    log.entries.length > AUDIT_MAX_ENTRIES ||
    !log.entries.every(validEntry)
  )
    throw new Error('Invalid audit log.');
  return log.entries;
}

/** No renderer arguments, paths, error messages, or content may enter this store. */
export function createAuditStore(resolver: MetadataResolver, now: () => number = Date.now) {
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>) => {
    const next = pending.then(work, work);
    pending = next.catch(() => undefined);
    return next;
  };
  async function read(): Promise<AuditEntry[]> {
    let filename: string;
    try {
      filename = await resolver.resolveMetadata('audit.json');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const file = await open(filename, 'r').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!file) return [];
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > AUDIT_MAX_BYTES) throw new Error('Audit log exceeds its size bound.');
      const buffer = Buffer.alloc(AUDIT_MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > AUDIT_MAX_BYTES) throw new Error('Audit log exceeds its size bound.');
      return validateLog(JSON.parse(buffer.subarray(0, length).toString('utf8')) as unknown);
    } finally {
      await file.close();
    }
  }
  return {
    record: (operation: AuditOperation, outcome: AuditOutcome): Promise<AuditWriteResult> =>
      serialize(async () => {
        if (!AUDIT_OPERATIONS.includes(operation) || !AUDIT_OUTCOMES.includes(outcome))
          return { recorded: false, reason: 'invalid-event' };
        let temporary: string | undefined;
        try {
          const time = now();
          const entry = { operation, outcome, time: new Date(time).toISOString() };
          if (!validEntry(entry)) return { recorded: false, reason: 'invalid-event' };
          const entries = (await read())
            .filter((item) => {
              const timestamp = Date.parse(item.time);
              return timestamp > time - AUDIT_RETENTION_MS && timestamp <= time;
            })
            .slice(-(AUDIT_MAX_ENTRIES - 1));
          entries.push(entry);
          const data = JSON.stringify({ version: 1, entries });
          if (Buffer.byteLength(data) > AUDIT_MAX_BYTES) throw new Error('Audit log exceeds its size bound.');
          const destination = await resolver.resolveMetadata('audit.json', true);
          // The app is single-instance and this store serializes writes. One staging
          // file bounds disk use across crashes; it is never treated as a committed log.
          temporary = await resolver.resolveMetadata('pending-audit.json', true);
          await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(data, 'utf8');
            await file.sync();
          } finally {
            await file.close();
          }
          await resolver.resolveMetadata('audit.json', true);
          await rename(temporary, destination);
          return { recorded: true };
        } catch {
          return { recorded: false, reason: 'storage-failure' };
        } finally {
          if (temporary) await unlink(temporary).catch(() => undefined);
        }
      }),
  };
}

export interface AuditAttempt {
  committed(): void;
  cancelled(): void;
}

/** Keep the operation's result separate from audit persistence, even after a commit. */
export async function runAudited<T>(
  store: ReturnType<typeof createAuditStore>,
  operation: AuditOperation,
  work: (attempt: AuditAttempt) => Promise<T>,
  warn: (message: string) => Promise<void>,
): Promise<T> {
  let committed = false;
  let cancelled = false;
  let value: T;
  let failure: unknown;
  let failed = false;
  try {
    value = await work({
      committed: () => {
        committed = true;
      },
      cancelled: () => {
        cancelled = true;
      },
    });
  } catch (error) {
    failed = true;
    failure = error;
  }
  const outcome = failed ? (committed ? 'committed-with-error' : 'failed') : cancelled ? 'cancelled' : 'succeeded';
  const result = await store.record(operation, outcome);
  if (!result.recorded) {
    await warn(
      failed
        ? committed
          ? 'The operation committed, but subsequent processing failed. Its audit entry could not be recorded.'
          : 'The operation failed. Its audit entry could not be recorded; this does not establish that disk changes were rolled back.'
        : cancelled
          ? 'The operation was cancelled. Its audit entry could not be recorded.'
          : 'The operation succeeded, but its audit entry could not be recorded. Do not repeat the operation just to retry logging.',
    ).catch(() => {
      console.error('Sensitive-action audit storage failed; the warning dialog could not be displayed.');
    });
  }
  if (failed) {
    if (committed)
      throw new Error(
        `The operation committed, but subsequent processing failed. ${failure instanceof Error ? failure.message : 'Reopen the vault to check its state.'}`,
      );
    throw failure;
  }
  return value!;
}
