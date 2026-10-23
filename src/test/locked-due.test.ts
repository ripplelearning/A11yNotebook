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
    watcher.arm([entry('a', 5), entry('b', 5), entry('c', 30)], '/vault');
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith('/vault');
    vi.advanceTimersByTime(25 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(2);
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
    watcher.arm([entry('a', 1)], '/vault-a');
    watcher.arm([entry('b', 2)], '/vault-b');
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue).toHaveBeenCalledWith('/vault-b');
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
