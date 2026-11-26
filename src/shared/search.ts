import type { CalendarAppointment } from './calendar';
import { normalizeDateText } from './calendar';
import type { Reminder } from './reminders';
import { formatReminderDateTime, formatTaskDueDate } from './reminders';
import type { VaultTask } from './types';

export interface VaultSearchQuery {
  text: string;
  notebook?: string;
  kind?: 'note' | 'attachment' | 'docx' | 'task' | 'reminder' | 'appointment';
  tag?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  limit?: number;
}

export interface VaultSearchResult {
  /** File path for notes/attachments; the note path for tasks and reminders; empty for appointments. */
  path: string;
  title: string;
  kind: 'note' | 'attachment' | 'docx' | 'task' | 'reminder' | 'appointment';
  notebook: string;
  tags: string[];
  modified: string;
  /** Plain text, never HTML; render as text rather than markup. */
  snippet: string;
  score: number;
  /** Task, reminder, or appointment id for the new kinds; absent for files. */
  targetId?: string;
}

export interface VaultChangedEvent {
  vaultPath: string;
  /** Vault-relative paths; an empty path means the whole vault may have changed. */
  paths: string[];
  /**
   * Epoch milliseconds when the most recent change in this batch was
   * observed by the watcher. Readers use it to ignore changes that
   * predate their load — for example the import's own write, whose
   * debounced event can arrive after the imported document is opened
   * and otherwise be mistaken for an external change.
   */
  changedAt?: number;
}

/** The notebook (parent directory) a vault-relative path lives in; '' for the library root. */
export function notebookForSearchPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Convert the typed search date filters to the query's YYYY-MM-DD form.
 * The filters are typed as MM/DD/YYYY (the one date format the app
 * shows), while the search query validator only accepts YYYY-MM-DD —
 * passing the typed text straight through made the whole search fail
 * validation, so no results displayed at all (1.9.23 retest, item 6).
 * A half-typed or impossible date drops out of the query instead of
 * failing it, so typing a date filter can never blank every result;
 * a reversed range drops both dates for the same reason. The raw typed
 * text stays in the filter fields — only the query is converted.
 */
export function normalizeSearchDateFilters(
  filters: Omit<VaultSearchQuery, 'text'>,
): Omit<VaultSearchQuery, 'text'> {
  const { modifiedAfter, modifiedBefore, ...rest } = filters;
  const after = modifiedAfter ? (normalizeDateText(modifiedAfter) ?? undefined) : undefined;
  const before = modifiedBefore ? (normalizeDateText(modifiedBefore) ?? undefined) : undefined;
  if (after && before && Date.parse(after) > Date.parse(before)) {
    return { ...rest };
  }
  return { ...rest, modifiedAfter: after, modifiedBefore: before };
}

function searchTerms(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAllTerms(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

function notebookMatches(notebook: string, filter: string | undefined): boolean {
  return filter === undefined || notebook === filter || (filter !== '' && notebook.startsWith(`${filter}/`));
}

/**
 * Tasks, reminders, and appointments matching a search query, using the
 * same term and notebook rules as the file index. Tasks and reminders
 * have no tags and no modified date, and appointments have no notebook
 * either, so a filter one of them cannot satisfy excludes that kind —
 * the filter semantics are documented where the filters are shown.
 * Scores mirror the file index (10 for a title hit, 1 for a text hit).
 */
export function searchTasksRemindersAppointments(
  query: VaultSearchQuery,
  items: { tasks: VaultTask[]; reminders: Reminder[]; appointments: CalendarAppointment[] },
): VaultSearchResult[] {
  const terms = searchTerms(query.text);
  const results: VaultSearchResult[] = [];
  if (query.kind === undefined || query.kind === 'task') {
    for (const task of items.tasks) {
      if (query.tag || query.modifiedAfter || query.modifiedBefore) continue;
      const notebook = notebookForSearchPath(task.path);
      if (!notebookMatches(notebook, query.notebook)) continue;
      if (!matchesAllTerms(task.text, terms)) continue;
      const titleHit = terms.length > 0 && terms.some((term) => task.text.toLowerCase().includes(term));
      const noteName = task.path.split('/').at(-1) ?? task.path;
      const due = task.dueDate ? `Due ${formatTaskDueDate(task.dueDate, task.dueTime)}` : '';
      const priority = task.priority ? `${task.priority} priority` : '';
      const context = [due, priority].filter(Boolean).join(' · ') || `In ${noteName}`;
      results.push({
        path: task.path,
        title: task.text,
        kind: 'task',
        notebook,
        tags: [],
        modified: '',
        snippet: context,
        score: titleHit ? 10 : 1,
        targetId: task.taskId ?? task.id,
      });
    }
  }
  if (query.kind === undefined || query.kind === 'reminder') {
    for (const reminder of items.reminders) {
      if (query.tag || query.modifiedAfter || query.modifiedBefore) continue;
      const notebook = reminder.path ? notebookForSearchPath(reminder.path) : '';
      if (!notebookMatches(notebook, query.notebook)) continue;
      if (!matchesAllTerms(reminder.title, terms)) continue;
      const titleHit = terms.length > 0 && terms.some((term) => reminder.title.toLowerCase().includes(term));
      const noteName = reminder.path?.split('/').at(-1);
      results.push({
        path: reminder.path ?? '',
        title: reminder.title,
        kind: 'reminder',
        notebook,
        tags: [],
        modified: '',
        snippet: `Reminder at ${formatReminderDateTime(reminder.scheduledAt)}${noteName ? ` · In ${noteName}` : ''}`,
        score: titleHit ? 10 : 1,
        targetId: reminder.id,
      });
    }
  }
  if (query.kind === undefined || query.kind === 'appointment') {
    for (const appointment of items.appointments) {
      if (query.tag || query.modifiedAfter || query.modifiedBefore) continue;
      // Appointments belong to no notebook, so a notebook filter excludes them.
      if (query.notebook !== undefined) continue;
      const haystack = [appointment.title, appointment.description ?? '', appointment.location ?? ''].join(' ');
      if (!matchesAllTerms(haystack, terms)) continue;
      const titleHit =
        terms.length > 0 && terms.some((term) => appointment.title.toLowerCase().includes(term));
      const when = appointment.allDay
        ? `All day ${appointment.start}`
        : formatReminderDateTime(appointment.start);
      results.push({
        path: '',
        title: appointment.title,
        kind: 'appointment',
        notebook: '',
        tags: [],
        modified: '',
        snippet: `${when}${appointment.location ? ` · ${appointment.location}` : ''}`,
        score: titleHit ? 10 : 1,
        targetId: appointment.id,
      });
    }
  }
  return results;
}
