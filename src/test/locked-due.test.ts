// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLockedDueWatcher, type DueSnapshotEntry } from '../../electron/vault/locked-due';

const entry = (id: string, minutesFromNow: number): DueSnapshotEntry => ({
  id,
  scheduledAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
  kind: 'reminder',
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 22, 12, 0));
});
afterEach(() => vi.useRealTimers());

describe('locked-library due watcher', () => {
  it('emits one generic signal per due batch and keeps watching later entries', () => {
    const onDue = vi.fn();
    const watcher = createLockedDueWatcher({ onDue });
    const armed = [entry('a', 5), entry('b', 5), entry('c', 30)];
    watcher.arm(armed, '/vault');
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith('/vault', [armed[0], armed[1]]);
    vi.advanceTimersByTime(25 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(2);
    expect(onDue).toHaveBeenLastCalledWith('/vault', [armed[2]]);
  });

  it('passes the due batch, including flashcards, so callers can name the kind', () => {
    const onDue = vi.fn();
    const watcher = createLockedDueWatcher({ onDue });
    const flashcard: DueSnapshotEntry = { id: 'f', scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString(), kind: 'flashcard' };
    const reminder = entry('r', 5);
    watcher.arm([flashcard, reminder], '/vault');
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith('/vault', [flashcard, reminder]);
  });

  it('never fires after cancellation, even for entries already due (lock/unlock race)', () => {
    const onDue = vi.fn();
    const watcher = createLockedDueWatcher({ onDue });
    watcher.arm([entry('a', 1)], '/vault');
    watcher.cancel(); // the library unlocked a moment before the due time
    vi.advanceTimersByTime(10 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
  });

  it('treats re-arming as a fresh session for the new library only', () => {
    const onDue = vi.fn();
    const watcher = createLockedDueWatcher({ onDue });
    const second = entry('b', 2);
    watcher.arm([entry('a', 1)], '/vault-a');
    watcher.arm([second], '/vault-b');
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith('/vault-b', [second]);
  });

  it('fires immediately for an entry whose time passed while arming', () => {
    const onDue = vi.fn();
    const watcher = createLockedDueWatcher({ onDue });
    watcher.arm([entry('a', -1)], '/vault');
    vi.advanceTimersByTime(0);
    expect(onDue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
  });
});
