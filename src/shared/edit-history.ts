// App-level undo/redo history for note content — the guaranteed fallback
// when the textarea's native undo stack is unavailable or has been
// invalidated (programmatic tool edits use a setRangeText fallback that
// cannot guarantee native undo, and controlled-value syncs can drop it).
// Pure and immutable so the model is fully unit-testable; the renderer
// keeps one history per open note.

export interface EditSnapshot {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface EditHistory {
  /** Snapshots taken before each recorded edit, oldest first. */
  past: EditSnapshot[];
  /** Snapshots captured when undoing, available to redo, oldest first. */
  future: EditSnapshot[];
  lastRecordedAt: number;
  lastKind: string | null;
}

export const EDIT_HISTORY_LIMIT = 100;
export const TYPING_COALESCE_MS = 1200;

export function createEditHistory(): EditHistory {
  return { past: [], future: [], lastRecordedAt: 0, lastKind: null };
}

/**
 * Record an edit. `before` becomes undoable unless this edit coalesces
 * into the previous one (a continuing typing burst: same kind 'typing'
 * within the coalesce window), in which case the burst's original
 * `before` stays on the stack and only the timestamp advances. Any new
 * edit clears the redo stack.
 */
export function recordEdit(
  history: EditHistory,
  before: EditSnapshot,
  after: EditSnapshot,
  kind: string,
  now: number,
): EditHistory {
  if (before.content === after.content) return history;
  const coalesce =
    kind === 'typing' && history.lastKind === 'typing' && now - history.lastRecordedAt <= TYPING_COALESCE_MS;
  if (coalesce) return { ...history, future: [], lastRecordedAt: now };
  const past = [...history.past, before];
  if (past.length > EDIT_HISTORY_LIMIT) past.splice(0, past.length - EDIT_HISTORY_LIMIT);
  return { past, future: [], lastRecordedAt: now, lastKind: kind };
}

export function undoEdit(
  history: EditHistory,
  current: EditSnapshot,
): { history: EditHistory; snapshot: EditSnapshot } | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastRecordedAt: 0,
      lastKind: null,
    },
    snapshot: previous,
  };
}

export function redoEdit(
  history: EditHistory,
  current: EditSnapshot,
): { history: EditHistory; snapshot: EditSnapshot } | null {
  const next = history.future.at(-1);
  if (!next) return null;
  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      lastRecordedAt: 0,
      lastKind: null,
    },
    snapshot: next,
  };
}

export function canUndo(history: EditHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditHistory): boolean {
  return history.future.length > 0;
}
