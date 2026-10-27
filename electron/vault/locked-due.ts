/**
 * Generic due alerts for a locked library.
 *
 * When a protected library locks, its reminder service stops (it can no
 * longer read protected content). Before it stops, the app keeps a
 * privacy-safe snapshot of upcoming due times — identifiers and times only
 * by default. The user may opt into named wake alerts (the
 * backgroundReminderTitles setting): then reminder titles join the
 * persisted snapshot so a Task Scheduler wake launch can name them.
 * Titles are stripped again at persist time unless that opt-in is on,
 * reminders marked hide-title never contribute a title, and locked-library
 * alerts stay generic either way. This watcher counts those times down
 * and emits a single content-free signal per due batch so the user still
 * hears the configured sound and sees a generic "A reminder is due. Unlock
 * the library to view it." alert.
 *
 * Cancellation is generation-based: arming or cancelling bumps the
 * generation, and a timer callback that wakes after a cancel (unlock,
 * library switch) observes the mismatch and does nothing. That makes the
 * lock-during-delivery race harmless.
 */
export interface DueSnapshotEntry {
  id: string;
  scheduledAt: string;
  kind: 'reminder' | 'flashcard';
  /** Reminder title, present only when the user opted into named wake alerts. */
  title?: string;
}

export interface LockedDueWatcher {
  /** (Re)arm against a fresh snapshot for the given library. */
  arm: (entries: DueSnapshotEntry[], vaultPath: string) => void;
  /** Stop watching; in-flight callbacks become no-ops. */
  cancel: () => void;
}

export function createLockedDueWatcher(options: {
  onDue: (vaultPath: string, due: DueSnapshotEntry[]) => void;
  now?: () => number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}): LockedDueWatcher {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let generation = 0;
  let timer: unknown;
  let entries: DueSnapshotEntry[] = [];
  let vaultPath = '';
  const fired = new Set<string>();

  const clearPendingTimer = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const scheduleNext = (expectedGeneration: number) => {
    if (expectedGeneration !== generation) return;
    const pending = entries.filter((entry) => !fired.has(entry.id));
    if (!pending.length) return;
    const nextAt = Math.min(...pending.map((entry) => Date.parse(entry.scheduledAt)));
    timer = setTimer(
      () => {
        timer = undefined;
        if (expectedGeneration !== generation) return; // cancelled while waiting
        const due = entries.filter((entry) => !fired.has(entry.id) && Date.parse(entry.scheduledAt) <= now());
        for (const entry of due) fired.add(entry.id);
        if (due.length) options.onDue(vaultPath, due);
        scheduleNext(expectedGeneration);
      },
      Math.max(0, nextAt - now()),
    );
  };

  return {
    arm: (nextEntries, nextVaultPath) => {
      generation += 1;
      clearPendingTimer();
      fired.clear();
      entries = [...nextEntries];
      vaultPath = nextVaultPath;
      scheduleNext(generation);
    },
    cancel: () => {
      generation += 1;
      clearPendingTimer();
      fired.clear();
      entries = [];
      vaultPath = '';
    },
  };
}
