import { randomUUID } from 'node:crypto';
import {
  isReminderPath, parseReminderDate, snoozeUntil,
  type CreateReminderInput, type Reminder, type ReminderState, type ReminderStore, type SnoozeDuration,
} from '../../src/shared/reminders';

export interface ReminderNote { path: string; content: string }
export interface ParsedReminderTask extends Reminder { complete: boolean }

/** Independent of the task index, so reminder markers need no task-parser changes. */
export function parseTaskReminders(content: string, path: string): ParsedReminderTask[] {
  if (!isReminderPath(path)) return [];
  let fence: string | null = null;
  return content.split(/\r?\n/).flatMap((line, index) => {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null;
      return [];
    }
    if (fence) return [];
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (!task) return [];
    const marker = /(?:\bremind:|⏰\s*)(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?![\d:])/i.exec(task[2]);
    const date = marker && parseReminderDate(marker[1]);
    if (!marker || !date) return [];
    const scheduledAt = date.toISOString();
    return [{
      id: `task:${path}:${index + 1}:${scheduledAt}`,
      source: 'task' as const,
      title: task[2].replace(marker[0], '').trim() || 'Task reminder',
      path, line: index + 1, scheduledAt, originalScheduledAt: scheduledAt,
      status: 'pending' as const, complete: task[1].toLowerCase() === 'x',
    }];
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createPathMigrator(from: string, to: string) {
  const validEntryPath = (value: string) => typeof value === 'string' &&
    !!value && !/^[\\/]|^[a-z]:|[\0\r\n]/i.test(value) &&
    value.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..') &&
    value.split(/[\\/]/)[0].toLowerCase() !== '.a11ynotebook';
  if (!validEntryPath(from) || !validEntryPath(to)) throw new Error('Invalid reminder migration path.');
  const source = from.replaceAll('\\', '/');
  const destination = to.replaceAll('\\', '/');
  return (path: string) => {
    const normalized = path.replaceAll('\\', '/');
    return normalized === source || normalized.startsWith(`${source}/`)
      ? `${destination}${normalized.slice(source.length)}` : path;
  };
}

function state(value: unknown): value is ReminderState {
  return object(value) &&
    typeof value.originalScheduledAt === 'string' && !!parseReminderDate(value.originalScheduledAt) &&
    typeof value.scheduledAt === 'string' && !!parseReminderDate(value.scheduledAt) &&
    typeof value.status === 'string' &&
    ['pending', 'fired', 'dismissed'].includes(value.status);
}

/** Missing stores are empty; malformed persisted metadata is rejected, never silently reset. */
export function validateReminderStore(value: unknown): ReminderStore {
  if (value === null || value === undefined) return { version: 1, standalone: [], states: {} };
  if (!object(value) || value.version !== 1 || !Array.isArray(value.standalone) || !object(value.states)) {
    throw new Error('Invalid reminder metadata.');
  }
  const ids = new Set<string>();
  const standalone = value.standalone.map((item: unknown) => {
    if (
      !state(item) || !object(item) || item.source !== 'standalone' ||
      typeof item.id !== 'string' || !item.id.startsWith('standalone:') || ids.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 ||
      typeof item.path !== 'string' || !isReminderPath(item.path)
    ) throw new Error('Invalid standalone reminder.');
    ids.add(item.id);
    return {
      id: item.id, source: 'standalone' as const, title: item.title, path: item.path,
      scheduledAt: new Date(item.scheduledAt).toISOString(),
      originalScheduledAt: new Date(item.originalScheduledAt).toISOString(), status: item.status,
    };
  });
  const states = Object.fromEntries(Object.entries(value.states).map(([id, item]) => {
    if (!id.startsWith('task:') || !state(item)) throw new Error('Invalid task reminder state.');
    return [id, {
      scheduledAt: new Date(item.scheduledAt).toISOString(),
      originalScheduledAt: new Date(item.originalScheduledAt).toISOString(), status: item.status,
    }];
  }));
  return { version: 1, standalone, states };
}

export interface ReminderServiceOptions {
  readStore: () => Promise<unknown>;
  writeStore: (store: ReminderStore) => Promise<void>;
  /** Must resolve only for an existing, safe Markdown file inside this vault. */
  validateNote: (path: string) => Promise<void>;
  getNotes: () => Promise<ReminderNote[]>;
  notify: (reminder: Reminder) => void | Promise<void>;
  onChange?: (reminders: Reminder[]) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** One scheduler per open vault. stop() permanently cancels this instance, including in-flight notifications. */
export function createReminderService(options: ReminderServiceOptions) {
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let store: ReminderStore = { version: 1, standalone: [], states: {} };
  let reminders: Reminder[] = [];
  let initialized = false;
  let stopped = false;
  let timer: unknown;
  let published = '';
  let queued: Promise<unknown> = Promise.resolve();
  const report = (error: unknown) => {
    try {
      void Promise.resolve(options.onError?.(error)).catch(() => undefined);
    } catch { /* Error reporting must not reject timer work. */ }
  };
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queued.then(operation);
    queued = result.catch(() => undefined);
    return result;
  };
  function requireActive() {
    if (stopped || !initialized) throw new Error('Reminder service is not active.');
  }
  function cancelTimer() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }
  function arm(delay?: number) {
    cancelTimer();
    if (stopped) return;
    const next = reminders.filter((item) => item.status === 'pending')
      .reduce((earliest, item) => Math.min(earliest, Date.parse(item.scheduledAt)), Infinity);
    if (delay === undefined && next === Infinity) return;
    timer = setTimer(() => {
      timer = undefined;
      void refresh().catch((error: unknown) => { report(error); arm(60_000); });
    }, Math.min(2_147_483_647, Math.max(0, delay ?? next - now().getTime())));
  }
  async function collect() {
    const notes = await options.getNotes();
    if (stopped) return;
    const tasks = notes.flatMap((note) => parseTaskReminders(note.content, note.path))
      .filter((task) => !task.complete)
      .map((parsed) => {
        const task: Reminder = {
          id: parsed.id, source: parsed.source, title: parsed.title, path: parsed.path,
          line: parsed.line, scheduledAt: parsed.scheduledAt,
          originalScheduledAt: parsed.originalScheduledAt, status: parsed.status,
        };
        const saved = store.states[task.id];
        return saved?.originalScheduledAt === task.originalScheduledAt ? { ...task, ...saved } : task;
      });
    const standalone: Reminder[] = [];
    for (const item of store.standalone) {
      try {
        await options.validateNote(item.path);
        standalone.push(item);
      } catch (error) { report(error); }
    }
    reminders = [...tasks, ...standalone].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }
  async function save(next: ReminderStore) {
    await options.writeStore(next);
    store = next;
  }
  async function update(item: Reminder, changes: Partial<ReminderState>) {
    const changed = { ...item, ...changes };
    const next: ReminderStore = item.source === 'standalone'
      ? { ...store, standalone: store.standalone.map((entry) => entry.id === item.id ? changed : entry) }
      : { ...store, states: { ...store.states, [item.id]: {
        originalScheduledAt: changed.originalScheduledAt, scheduledAt: changed.scheduledAt, status: changed.status,
      } } };
    await save(next);
    reminders = reminders.map((entry) => entry.id === item.id ? changed : entry);
    return changed;
  }
  async function publish() {
    if (stopped) return;
    const signature = JSON.stringify(reminders);
    if (signature === published) return;
    published = signature;
    try { await options.onChange?.(reminders.map((item) => ({ ...item }))); } catch (error) { report(error); }
  }
  async function tick() {
    await collect();
    if (stopped) return;
    for (const item of reminders.filter((entry) => entry.status === 'pending' && Date.parse(entry.scheduledAt) <= now().getTime())) {
      if (stopped) return;
      // Persist first: a restart must not repeat an already delivered notification.
      const fired = await update(item, { status: 'fired' });
      if (stopped) return;
      try { await options.notify(fired); } catch (error) { report(error); }
    }
    await publish();
    arm();
  }
  function refresh() {
    return serial(async () => { requireActive(); await tick(); return reminders.map((item) => ({ ...item })); });
  }
  async function mutate(id: string, changes: Partial<ReminderState>) {
    requireActive();
    await collect();
    requireActive();
    const item = reminders.find((entry) => entry.id === id);
    if (!item) throw new Error('Reminder no longer exists.');
    await update(item, changes);
    await tick();
    return reminders.map((entry) => ({ ...entry }));
  }
  async function migratePaths(from: string, to: string) {
    if (!initialized) throw new Error('Initialize reminders before migrating paths.');
    const migrate = createPathMigrator(from, to);
    const standalone = store.standalone.map((item) => ({ ...item, path: migrate(item.path) }));
    const states = Object.fromEntries(Object.entries(store.states).map(([id, saved]) => {
      const task = /^task:(.*):(\d+):(\d{4}-\d{2}-\d{2}T.*Z)$/.exec(id);
      return [task ? `task:${migrate(task[1])}:${task[2]}:${task[3]}` : id, saved];
    }));
    await save(validateReminderStore({ ...store, standalone, states }));
    // Migration is permitted after stop() so a filesystem move cannot race notifications.
    if (!stopped) await tick();
    else reminders = reminders.map((item) => ({
      ...item,
      path: migrate(item.path),
      ...(item.source === 'task'
        ? { id: `task:${migrate(item.path)}:${item.line}:${item.originalScheduledAt}` } : {}),
    }));
    return reminders.map((entry) => ({ ...entry }));
  }
  return {
    initialize: () => serial(async () => {
      if (stopped) throw new Error('Reminder service has stopped.');
      if (!initialized) {
        store = validateReminderStore(await options.readStore());
        if (stopped) return [];
        initialized = true;
      }
      await tick();
      return reminders.map((item) => ({ ...item }));
    }),
    refresh,
    getReminders: refresh,
    createReminder: (input: CreateReminderInput) => serial(async () => {
      requireActive();
      const date = parseReminderDate(input?.scheduledAt);
      if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500 ||
        !isReminderPath(input.path) || !date) throw new Error('Enter a title, valid note, and valid reminder date.');
      await options.validateNote(input.path);
      requireActive();
      const item: Reminder = {
        id: `standalone:${randomUUID()}`, source: 'standalone', title: input.title.trim(), path: input.path,
        scheduledAt: date.toISOString(), originalScheduledAt: date.toISOString(), status: 'pending',
      };
      await save({ ...store, standalone: [...store.standalone, item] });
      await tick();
      return reminders.map((entry) => ({ ...entry }));
    }),
    dismissReminder: (id: string) => serial(() => mutate(id, { status: 'dismissed' })),
    snoozeReminder: (id: string, duration: SnoozeDuration) => serial(() => mutate(id, {
      status: 'pending', scheduledAt: snoozeUntil(now(), duration).toISOString(),
    })),
    migratePaths: (from: string, to: string) => serial(() => migratePaths(from, to)),
    /** Serializes relocation with timer work. The callback must not await this service's queued methods.
     * If migration persistence fails after relocation, the scheduler stops; filesystem rollback belongs to the caller.
     */
    withPathMigration: <T>(from: string, to: string, operation: () => Promise<T>): Promise<T> => serial(async () => {
      requireActive();
      createPathMigrator(from, to);
      const result = await operation();
      try { await migratePaths(from, to); }
      catch (error) {
        stopped = true;
        cancelTimer();
        throw error;
      }
      return result;
    }),
    stop: () => { stopped = true; cancelTimer(); },
  };
}
