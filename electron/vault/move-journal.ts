// Crash recovery for multi-file moves. A confirmed move touches many
// files: the entry rename, link-repair rewrites in other notes, and path
// migrations across metadata stores. The in-process path rolls back on
// failure, but a crash or power loss mid-move used to leave the library
// half-moved with no record of the intent. Before a move starts, the
// operation is journaled; on the next open/unlock the journal is rolled
// forward idempotently (the user already confirmed the move) and cleared.

export interface MoveJournalRepair {
  path: string;
  nextPath: string;
  before: string;
  after: string;
}

export interface MoveJournal {
  version: 1;
  source: string;
  destination: string;
  repairs: MoveJournalRepair[];
  startedAt: string;
}

export function parseMoveJournal(value: unknown): MoveJournal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const journal = value as Partial<MoveJournal>;
  if (journal.version !== 1) return null;
  if (typeof journal.source !== 'string' || !journal.source) return null;
  if (typeof journal.destination !== 'string' || !journal.destination) return null;
  if (!Array.isArray(journal.repairs)) return null;
  for (const repair of journal.repairs) {
    if (!repair || typeof repair !== 'object') return null;
    const item = repair as Partial<MoveJournalRepair>;
    if (
      typeof item.path !== 'string' ||
      typeof item.nextPath !== 'string' ||
      typeof item.before !== 'string' ||
      typeof item.after !== 'string'
    )
      return null;
  }
  return {
    version: 1,
    source: journal.source,
    destination: journal.destination,
    repairs: journal.repairs,
    startedAt: typeof journal.startedAt === 'string' ? journal.startedAt : '',
  };
}

export type MoveRecoveryAction =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'write-note'; path: string }
  | { kind: 'migrate' }
  | { kind: 'conflict'; path: string; reason: string };

export interface MoveRecoverySnapshot {
  sourceExists: boolean;
  destinationExists: boolean;
  /** Current content of each repair's nextPath file, or null when unreadable/missing. */
  contents: Map<string, string | null>;
}

/**
 * Plan the roll-forward of an interrupted move from an observed snapshot.
 * Every step is idempotent: work already done is skipped, work not yet
 * done is scheduled, and anything that no longer matches either side of
 * the recorded change is reported as a conflict instead of overwritten.
 */
export function planMoveRecovery(journal: MoveJournal, snapshot: MoveRecoverySnapshot): MoveRecoveryAction[] {
  const actions: MoveRecoveryAction[] = [];
  if (snapshot.sourceExists && !snapshot.destinationExists) {
    actions.push({ kind: 'rename', from: journal.source, to: journal.destination });
  } else if (snapshot.sourceExists && snapshot.destinationExists) {
    actions.push({
      kind: 'conflict',
      path: journal.destination,
      reason: 'Both the original and the destination exist; the move was not completed automatically.',
    });
  } else if (!snapshot.sourceExists && !snapshot.destinationExists) {
    actions.push({
      kind: 'conflict',
      path: journal.source,
      reason: 'Neither the original nor the destination exists; the moved item could not be found.',
    });
  }
  for (const repair of journal.repairs) {
    const current = snapshot.contents.get(repair.nextPath);
    if (current === repair.after) continue; // already rewritten before the interruption
    if (current === repair.before) {
      actions.push({ kind: 'write-note', path: repair.nextPath });
    } else {
      actions.push({
        kind: 'conflict',
        path: repair.nextPath,
        reason: 'The note changed after the interrupted move; its links were not rewritten.',
      });
    }
  }
  actions.push({ kind: 'migrate' });
  return actions;
}
