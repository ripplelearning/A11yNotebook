export type SnoozeDuration = 5 | 15 | 30 | 60 | 1440 | 'tomorrow';
export type ReminderStatus = 'pending' | 'fired' | 'dismissed' | 'completed';

export interface Reminder {
  id: string;
  source: 'task' | 'standalone';
  title: string;
  path: string;
  line?: number;
  scheduledAt: string;
  originalScheduledAt: string;
  status: ReminderStatus;
  privacy?: 'show-title' | 'hide-title';
  notification?: boolean;
  revision?: string;
}

export interface CreateReminderInput {
  title: string;
  path: string;
  /** Local YYYY-MM-DD HH:mm or an ISO timestamp with timezone. */
  scheduledAt: string;
  privacy?: 'show-title' | 'hide-title';
  notification?: boolean;
}

export interface ReminderState {
  originalScheduledAt: string;
  scheduledAt: string;
  status: ReminderStatus;
}

export interface ReminderStore {
  version: 1;
  standalone: Reminder[];
  states: Record<string, ReminderState>;
  reviewStates?: Record<string, string>;
}

/** Kinds a locked-library due batch can contain. Absent means reminders only. */
export type LockedDueKind = 'reminder' | 'flashcard';

export type VaultReminderEvent =
  | { type: 'fired' | 'open'; vaultPath: string; reminder: Reminder }
  | { type: 'flashcard-due'; vaultPath: string }
  | { type: 'locked-due'; vaultPath: string; kinds?: LockedDueKind[] }
  | { type: 'changed'; vaultPath: string; reminders: Reminder[] }
  | { type: 'error'; vaultPath: string; message: string };

export interface DueFlashcardReview {
  id: string;
  path: string;
  scheduledAt: string;
}

/**
 * Wording for a locked-library due batch. Reminder-only batches keep the
 * long-standing text exactly; flashcard-only batches name flashcards, and
 * mixed batches name both. The locked alert never names a reminder, a
 * flashcard, or any content — only the kind of thing that is due.
 */
export function lockedDueText(
  kinds: LockedDueKind[],
  count: number,
): { headline: string; detail: string; waiting: string; title: string } {
  const hasReminder = kinds.includes('reminder');
  const hasFlashcard = kinds.includes('flashcard');
  if (hasFlashcard && !hasReminder) {
    return {
      headline: count === 1 ? 'A flashcard is due for review.' : `${count} flashcards are due for review.`,
      detail: count === 1 ? 'Unlock the library to review it.' : 'Unlock the library to review them.',
      waiting: count === 1 ? '1 flashcard waiting.' : `${count} flashcards waiting.`,
      title: 'Flashcard review',
    };
  }
  if (hasReminder && hasFlashcard) {
    return {
      headline: 'Reminders and flashcards are due.',
      detail: 'Unlock the library to view them.',
      waiting: 'Reminders and flashcards waiting.',
      title: 'Due reminders and flashcards',
    };
  }
  return {
    headline: count === 1 ? 'A reminder is due.' : `${count} reminders are due.`,
    detail: count === 1 ? 'Unlock the library to view it.' : 'Unlock the library to view them.',
    waiting: count === 1 ? '1 reminder waiting.' : `${count} reminders waiting.`,
    title: 'Reminder',
  };
}

/** Calendar validation avoids Date's silent rollover of impossible dates. */
export function parseReminderDate(value: string): Date | null {
  if (typeof value !== 'string') return null;
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (local) {
    const [, y, m, d, h, min] = local.map(Number);
    if (y < 1000 || m < 1 || m > 12 || d < 1 || h > 23 || min > 59) return null;
    const date = new Date(y, m - 1, d, h, min);
    return date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d &&
      date.getHours() === h &&
      date.getMinutes() === min
      ? date
      : null;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!iso || Number(iso[3]) > 59) return null;
  const [, day, time, , zone] = iso;
  // Validate wall-clock components without depending on the host timezone.
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = new Date(Date.UTC(year, month - 1, date, hour, minute));
  if (
    year < 1000 ||
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== date ||
    hour > 23 ||
    minute > 59 ||
    (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}

export function isReminderPath(path: string): boolean {
  return (
    typeof path === 'string' &&
    !/^[\\/]|^[a-z]:|[\0\r\n]/i.test(path) &&
    /\.(?:md|html)$/i.test(path) &&
    path.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..') &&
    path.split(/[\\/]/)[0].toLowerCase() !== '.a11ynotebook'
  );
}

/** Tomorrow means the same local clock time on the next calendar day. */
export function snoozeUntil(now: Date, duration: SnoozeDuration): Date {
  if (duration === 'tomorrow') {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (![5, 15, 30, 60, 1440].includes(duration)) throw new Error('Invalid snooze duration.');
  return new Date(now.getTime() + duration * 60_000);
}

export function groupReminders(reminders: Reminder[], now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - ((now.getDay() + 6) % 7)));
  const result: { overdue: Reminder[]; today: Reminder[]; thisWeek: Reminder[] } = {
    overdue: [],
    today: [],
    thisWeek: [],
  };
  for (const reminder of reminders) {
    if (reminder.status === 'dismissed' || reminder.status === 'completed') continue;
    const at = parseReminderDate(reminder.scheduledAt);
    if (!at) continue;
    if (at < now) result.overdue.push(reminder);
    else if (at < tomorrow) result.today.push(reminder);
    else if (at < weekEnd) result.thisWeek.push(reminder);
  }
  return result;
}
