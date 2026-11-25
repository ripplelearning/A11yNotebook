// Rewriting one Markdown task line's schedule and priority markers.
// Kept in shared so both the renderer and tests can use it.

/**
 * A task date in either accepted form: YYYY-MM-DD (the stored form) or
 * MM/DD/YYYY (the form the user guide documents). One-digit month and
 * day are accepted in the MM/DD/YYYY form.
 */
export const TASK_DATE_PATTERN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})`;

/** A task reminder date-time in either accepted date form. */
export const TASK_DATE_TIME_PATTERN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}) \d{2}:\d{2}`;

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Accept a task date in YYYY-MM-DD (storage) or MM/DD/YYYY form and
 * return the stored YYYY-MM-DD form, or undefined when it is not a real
 * calendar date. Existing notes use YYYY-MM-DD and keep working; notes
 * typed the way the guide documents them (MM/DD/YYYY) read the same.
 */
export function normalizeTaskDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isRealDate(year, month, day) ? value : undefined;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : undefined;
  }
  return undefined;
}

/**
 * Accept a task reminder date-time in either date form and return the
 * stored "YYYY-MM-DD HH:mm" form, or undefined when the date or time is
 * not real.
 */
export function normalizeTaskDateTime(value: string): string | undefined {
  const match = new RegExp(`^(${TASK_DATE_PATTERN}) (\\d{2}):(\\d{2})$`).exec(value);
  if (!match) return undefined;
  const date = normalizeTaskDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!date || hour > 23 || minute > 59) return undefined;
  return `${date} ${match[2]}:${match[3]}`;
}

export interface MarkdownTaskScheduleUpdate {
  dueDate: string;
  dueTime: string;
  /** Reminder in "YYYY-MM-DD HH:mm" form, or '' for none. */
  remindAt: string;
}

/**
 * Rewrite one Markdown task line's schedule and priority markers, keeping
 * the task text intact.
 *
 * Markers always land before the trailing `<!-- a11y-task-id:… -->`
 * comment: the stable-id matcher in parseTaskReminders is $-anchored, so
 * markers appended after the comment break the id and the reminder falls
 * back to a line number, losing its fired/dismissed state across edits
 * above the task. Lines without an id comment get markers appended.
 */
export function updateMarkdownTaskLine(
  line: string,
  update: { schedule?: MarkdownTaskScheduleUpdate; priority?: string },
): string {
  const appendMarker = (text: string, marker: string): string => {
    const comment = /(<!--\s*a11y-task-id:[\w-]{8,80}\s*-->)$/.exec(text);
    if (!comment) return `${text}${marker}`;
    return `${text.slice(0, comment.index).replace(/\s+$/, '')}${marker} ${comment[1]}`;
  };
  let next = line;
  if (update.schedule) {
    const { dueDate, dueTime, remindAt } = update.schedule;
    // Strip markers in either accepted date form, so rescheduling a task
    // typed the way the guide documents it (MM/DD/YYYY) replaces the old
    // marker instead of leaving a second one behind.
    next = next
      .replace(new RegExp(`\\s+(?:due:${TASK_DATE_PATTERN}|📅\\s+${TASK_DATE_PATTERN})`, 'g'), '')
      .replace(/\s+due-time:\d{2}:\d{2}/g, '')
      .replace(new RegExp(`\\s+(?:remind:${TASK_DATE_TIME_PATTERN}|⏰\\s+${TASK_DATE_TIME_PATTERN})`, 'g'), '');
    if (dueDate) next = appendMarker(next, ` due:${dueDate}`);
    if (dueTime) next = appendMarker(next, ` due-time:${dueTime}`);
    if (remindAt) next = appendMarker(next, ` remind:${remindAt}`);
  }
  if (update.priority !== undefined) {
    next = next.replace(/\s+priority:[^\s]+/g, '');
    if (update.priority) next = appendMarker(next, ` priority:${update.priority}`);
  }
  return next;
}
