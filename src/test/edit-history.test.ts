// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createEditHistory,
  recordEdit,
  redoEdit,
  undoEdit,
  type EditSnapshot,
} from '../shared/edit-history';

const snap = (content: string, selectionStart = content.length): EditSnapshot => ({
  content,
  selectionStart,
  selectionEnd: selectionStart,
});

describe('edit history (fallback undo)', () => {
  it('undoes and redoes a single edit, restoring content and caret', () => {
    let history = createEditHistory();
    history = recordEdit(history, snap('a', 1), snap('ab', 2), 'edit', 1000);
    expect(canUndo(history)).toBe(true);
    const undone = undoEdit(history, snap('ab', 2));
    expect(undone?.snapshot).toEqual(snap('a', 1));
    expect(canRedo(undone!.history)).toBe(true);
    const redone = redoEdit(undone!.history, snap('a', 1));
    expect(redone?.snapshot).toEqual(snap('ab', 2));
    expect(redoEdit(redone!.history, snap('ab', 2))).toBeNull();
  });

  it('coalesces a typing burst into one undo step but not across a pause', () => {
    let history = createEditHistory();
    history = recordEdit(history, snap(''), snap('h'), 'typing', 0);
    history = recordEdit(history, snap('h'), snap('he'), 'typing', 300);
    history = recordEdit(history, snap('he'), snap('hel'), 'typing', 600);
    expect(history.past).toHaveLength(1);
    expect(undoEdit(history, snap('hel'))?.snapshot.content).toBe('');
    // A pause longer than the coalesce window starts a new step.
    history = recordEdit(history, snap('hel'), snap('hell'), 'typing', 5000);
    expect(history.past).toHaveLength(2);
  });

  it('never coalesces explicit edits, and a new edit clears the redo stack', () => {
    let history = createEditHistory();
    history = recordEdit(history, snap('a'), snap('a**b**'), 'edit', 0);
    history = recordEdit(history, snap('a**b**'), snap('a**b**c'), 'edit', 100);
    expect(history.past).toHaveLength(2);
    const undone = undoEdit(history, snap('a**b**c'))!;
    const branched = recordEdit(undone.history, snap('a**b**'), snap('a**b**X'), 'edit', 200);
    expect(canRedo(branched)).toBe(false);
  });

  it('ignores no-change records and caps the history', () => {
    let history = createEditHistory();
    history = recordEdit(history, snap('same'), snap('same'), 'edit', 0);
    expect(history.past).toHaveLength(0);
    for (let index = 0; index < 120; index += 1) {
      history = recordEdit(history, snap(`v${index}`), snap(`v${index + 1}`), 'edit', index * 2000);
    }
    expect(history.past).toHaveLength(100);
    expect(history.past[0].content).toBe('v20');
  });
});
