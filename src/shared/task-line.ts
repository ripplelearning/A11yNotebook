// Rewriting one Markdown task line's schedule and priority markers.
// Kept in shared so both the renderer and tests can use it.

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
    next = next
      .replace(/\s+(?:due:\d{4}-\d{2}-\d{2}|📅\s+\d{4}-\d{2}-\d{2})/g, '')
      .replace(/\s+due-time:\d{2}:\d{2}/g, '')
      .replace(/\s+remind:\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '');
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
