/**
 * The unified undo timeline: one chronological record across the two
 * undoable action kinds (note edits and task toggles). Previously edits
 * and toggles lived on separate stacks and Edit Undo always drained the
 * edit stack first, so an edit→toggle→undo sequence undid the older edit
 * instead of the newer toggle. The timeline fixes the order: undo pops
 * the most recent action whatever its kind, and redo replays undone
 * actions in reverse. The stacks themselves stay where they are (per-note
 * edit histories, one toggle stack); this module only orders them.
 *
 * Pure and immutable-ish: the state object is mutated in place by design
 * (it lives in a renderer ref), but every transition is a plain array
 * operation, so the ordering rules are fully unit-testable.
 */

export type UndoTimelineToken = { kind: 'edit'; noteId: string } | { kind: 'toggle' };

export interface UndoTimelineState {
  undo: UndoTimelineToken[];
  redo: UndoTimelineToken[];
}

export function createUndoTimeline(): UndoTimelineState {
  return { undo: [], redo: [] };
}

/** Record a new action: it becomes the next undo, and redo is cleared. */
export function recordTimelineAction(state: UndoTimelineState, token: UndoTimelineToken): void {
  state.undo.push(token);
  state.redo = [];
}

/** Take the next undo token, or undefined when there is nothing to undo. */
export function takeTimelineUndo(state: UndoTimelineState): UndoTimelineToken | undefined {
  return state.undo.pop();
}

/** Return a token that could not be undone to the top of the undo stack. */
export function restoreTimelineUndo(state: UndoTimelineState, token: UndoTimelineToken): void {
  state.undo.push(token);
}

/** An undone token becomes the next redo. */
export function completeTimelineUndo(state: UndoTimelineState, token: UndoTimelineToken): void {
  state.redo.push(token);
}

/** Take the next redo token, or undefined when there is nothing to redo. */
export function takeTimelineRedo(state: UndoTimelineState): UndoTimelineToken | undefined {
  return state.redo.pop();
}

/** Return a token that could not be redone to the top of the redo stack. */
export function restoreTimelineRedo(state: UndoTimelineState, token: UndoTimelineToken): void {
  state.redo.push(token);
}

/** A redone token becomes the next undo again. */
export function completeTimelineRedo(state: UndoTimelineState, token: UndoTimelineToken): void {
  state.undo.push(token);
}

/** Drop every token for a note whose edit history is gone (closed, or invalidated). */
export function purgeTimelineNote(state: UndoTimelineState, noteId: string): void {
  state.undo = state.undo.filter((token) => !(token.kind === 'edit' && token.noteId === noteId));
  state.redo = state.redo.filter((token) => !(token.kind === 'edit' && token.noteId === noteId));
}
