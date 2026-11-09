import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createStatusAnnouncer } from '../renderer/status-announcer';

/**
 * A stand-in for React's setState: records every update and applies
 * functional updates against the current value, the way useState does.
 */
function createRecordingSetter(initial: string) {
  let value = initial;
  const seen: string[] = [];
  const set: Dispatch<SetStateAction<string>> = (update) => {
    value = typeof update === 'function' ? update(value) : update;
    seen.push(value);
  };
  return {
    set,
    seen,
    get value() {
      return value;
    },
  };
}

describe('createStatusAnnouncer', () => {
  it('re-announces the identical message on a second call: clear, set, clear, set', () => {
    vi.useFakeTimers();
    try {
      const state = createRecordingSetter('Ready');
      const announce = createStatusAnnouncer(state.set);

      announce('task');
      // Cleared synchronously, so the live region text changes...
      expect(state.value).toBe('');
      vi.advanceTimersByTime(50);
      expect(state.value).toBe('task');

      announce('task');
      // ...and cleared again, so the identical message announces a second time.
      expect(state.value).toBe('');
      vi.advanceTimersByTime(50);
      expect(state.value).toBe('task');

      expect(state.seen).toEqual(['', 'task', '', 'task']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only the latest call announces when calls come faster than the delay', () => {
    vi.useFakeTimers();
    try {
      const state = createRecordingSetter('Ready');
      const announce = createStatusAnnouncer(state.set);

      announce('task');
      vi.advanceTimersByTime(20);
      announce('task');
      vi.advanceTimersByTime(50);
      expect(state.seen).toEqual(['', '', 'task']);
      expect(state.value).toBe('task');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not set the message while a dialog is open', () => {
    vi.useFakeTimers();
    try {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.appendChild(dialog);
      try {
        const state = createRecordingSetter('Ready');
        const announce = createStatusAnnouncer(state.set);
        announce('task');
        expect(state.value).toBe('');
        vi.advanceTimersByTime(50);
        expect(state.value).toBe('');
      } finally {
        dialog.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a newer message that landed during the delay instead of clobbering it', () => {
    vi.useFakeTimers();
    try {
      const state = createRecordingSetter('Ready');
      const announce = createStatusAnnouncer(state.set);
      announce('task');
      state.set('Something else');
      vi.advanceTimersByTime(50);
      expect(state.value).toBe('Something else');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel prevents a pending announcement from firing', () => {
    vi.useFakeTimers();
    try {
      const state = createRecordingSetter('Ready');
      const announce = createStatusAnnouncer(state.set);
      announce('task');
      announce.cancel();
      vi.advanceTimersByTime(100);
      expect(state.value).toBe('');
      expect(state.seen).toEqual(['']);
    } finally {
      vi.useRealTimers();
    }
  });
});
