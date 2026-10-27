import { describe, expect, it } from 'vitest';
import {
  completeTimelineRedo,
  completeTimelineUndo,
  createUndoTimeline,
  purgeTimelineNote,
  recordTimelineAction,
  restoreTimelineRedo,
  restoreTimelineUndo,
  takeTimelineRedo,
  takeTimelineUndo,
} from '../shared/undo-timeline';

describe('unified undo timeline', () => {
  it('undoes in reverse chronological order across edits and toggles', () => {
    const timeline = createUndoTimeline();
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'a' });
    recordTimelineAction(timeline, { kind: 'toggle' });
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'b' });
    expect(takeTimelineUndo(timeline)).toEqual({ kind: 'edit', noteId: 'b' });
    expect(takeTimelineUndo(timeline)).toEqual({ kind: 'toggle' });
    expect(takeTimelineUndo(timeline)).toEqual({ kind: 'edit', noteId: 'a' });
    expect(takeTimelineUndo(timeline)).toBeUndefined();
  });

  it('redoes undone actions in reverse undo order, and a new action clears redo', () => {
    const timeline = createUndoTimeline();
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'a' });
    recordTimelineAction(timeline, { kind: 'toggle' });
    const first = takeTimelineUndo(timeline)!;
    completeTimelineUndo(timeline, first);
    const second = takeTimelineUndo(timeline)!;
    completeTimelineUndo(timeline, second);
    expect(takeTimelineRedo(timeline)).toEqual({ kind: 'edit', noteId: 'a' });
    expect(takeTimelineRedo(timeline)).toEqual({ kind: 'toggle' });
    completeTimelineRedo(timeline, { kind: 'toggle' });
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'b' });
    expect(timeline.redo).toEqual([]);
    expect(takeTimelineUndo(timeline)).toEqual({ kind: 'edit', noteId: 'b' });
  });

  it('restores a refused token to the top of its stack', () => {
    const timeline = createUndoTimeline();
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'a' });
    recordTimelineAction(timeline, { kind: 'toggle' });
    const token = takeTimelineUndo(timeline)!;
    restoreTimelineUndo(timeline, token);
    expect(takeTimelineUndo(timeline)).toEqual({ kind: 'toggle' });
    const redoToken = takeTimelineRedo(timeline);
    expect(redoToken).toBeUndefined();
    completeTimelineUndo(timeline, { kind: 'toggle' });
    const redo = takeTimelineRedo(timeline)!;
    restoreTimelineRedo(timeline, redo);
    expect(takeTimelineRedo(timeline)).toEqual({ kind: 'toggle' });
  });

  it('purges a closed or invalidated note from both stacks', () => {
    const timeline = createUndoTimeline();
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'a' });
    recordTimelineAction(timeline, { kind: 'toggle' });
    recordTimelineAction(timeline, { kind: 'edit', noteId: 'b' });
    completeTimelineUndo(timeline, { kind: 'edit', noteId: 'a' });
    purgeTimelineNote(timeline, 'a');
    expect(timeline.undo).toEqual([{ kind: 'toggle' }, { kind: 'edit', noteId: 'b' }]);
    expect(timeline.redo).toEqual([]);
  });
});
