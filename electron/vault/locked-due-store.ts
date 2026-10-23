import type { DueSnapshotEntry } from './locked-due';

/**
 * Persistence for the privacy-safe due snapshot (ids, times, and
 * kinds only — never titles or paths). The snapshot is stored in the
 * library's metadata as locked-due.json so a process launched by the
 * Windows Task Scheduler after the app has exited can still see what
 * is due, show generic alerts, and re-register the next trigger.
 * Times are schedule metadata, not content; the file is documented
 * as a deliberate exclusion in the security notes.
 */
export const LOCKED_DUE_SNAPSHOT_FILE = 'locked-due.json';
const MAX_SNAPSHOT_ENTRIES = 1000;

export function validateDueSnapshot(value: unknown): DueSnapshotEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const valid: DueSnapshotEntry[] = [];
  for (const entry of entries) {
    if (valid.length >= MAX_SNAPSHOT_ENTRIES) break;
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<DueSnapshotEntry>;
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      typeof candidate.scheduledAt !== 'string' ||
      !Number.isFinite(Date.parse(candidate.scheduledAt)) ||
      (candidate.kind !== 'reminder' && candidate.kind !== 'flashcard') ||
      seen.has(candidate.id)
    )
      continue;
    seen.add(candidate.id);
    valid.push({ id: candidate.id, scheduledAt: candidate.scheduledAt, kind: candidate.kind });
  }
  return valid.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export function serializeDueSnapshot(entries: DueSnapshotEntry[]): { version: 1; entries: DueSnapshotEntry[] } {
  return { version: 1, entries: validateDueSnapshot({ entries }) };
}
