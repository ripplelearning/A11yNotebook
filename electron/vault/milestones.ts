import { randomUUID } from 'node:crypto';
import type {
  Milestone,
  MilestoneProgress,
  MilestoneStatus,
  MilestoneTaskAssociation,
  MilestoneUpdate,
  NewMilestone,
} from '../../src/shared/milestones';
import type { VaultTask } from '../../src/shared/types';
import { isReminderPath } from '../../src/shared/reminders';

interface MilestoneRecord extends Omit<Milestone, 'progress'> {}
interface MilestoneStore {
  version: 1;
  milestones: MilestoneRecord[];
}

interface MilestoneServiceOptions {
  readStore: () => Promise<unknown>;
  writeStore: (store: MilestoneStore) => Promise<void>;
  getTasks: () => Promise<VaultTask[]>;
  readNote: (path: string) => Promise<string>;
  saveNote: (path: string, content: string, expected: string) => Promise<void>;
  validateNote: (path: string) => Promise<void>;
  now?: () => Date;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isReminderPath(value) &&
    !value.includes('\\') &&
    value.split('/').every((part) => part !== '.' && part !== '..')
  );
}

function validTaskAssociation(value: unknown): value is MilestoneTaskAssociation {
  return (
    object(value) &&
    validPath(value.path) &&
    typeof value.taskId === 'string' &&
    /^[\w-]{8,80}$/.test(value.taskId)
  );
}

export function validateMilestoneStore(value: unknown): MilestoneStore {
  if (value === null || value === undefined) return { version: 1, milestones: [] };
  if (!object(value) || value.version !== 1 || !Array.isArray(value.milestones)) {
    throw new Error('Invalid milestone metadata.');
  }
  const ids = new Set<string>();
  const milestones = value.milestones.map((item): MilestoneRecord => {
    if (
      !object(item) ||
      typeof item.id !== 'string' ||
      !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 500 ||
      !validDate(item.dueDate) ||
      !['planned', 'active', 'completed', 'cancelled'].includes(item.status as string) ||
      !Array.isArray(item.notePaths) ||
      item.notePaths.length > 1000 ||
      !item.notePaths.every(validPath) ||
      new Set(item.notePaths).size !== item.notePaths.length ||
      !Array.isArray(item.tasks) ||
      item.tasks.length > 1000 ||
      !item.tasks.every(validTaskAssociation) ||
      new Set(item.tasks.map((task) => `${task.path}\0${task.taskId}`)).size !== item.tasks.length ||
      typeof item.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      typeof item.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.updatedAt))
    ) {
      throw new Error('Invalid milestone record.');
    }
    ids.add(item.id);
    return {
      id: item.id,
      title: item.title.trim(),
      dueDate: item.dueDate,
      status: item.status as MilestoneStatus,
      notePaths: [...item.notePaths],
      tasks: item.tasks.map((task) => ({ path: task.path, taskId: task.taskId })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
  return { version: 1, milestones };
}

function milestoneProgress(
  associations: MilestoneTaskAssociation[],
  currentTasks: VaultTask[],
): MilestoneProgress {
  const completed = associations.filter((association) =>
    currentTasks.some(
      (task) => task.path === association.path && task.taskId === association.taskId && task.complete,
    ),
  ).length;
  const found = associations.filter((association) =>
    currentTasks.some((task) => task.path === association.path && task.taskId === association.taskId),
  ).length;
  const total = associations.length;
  const missing = total - found;
  const percentage = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, missing, percentage, summary: `${completed} of ${total} tasks complete` };
}

function pathMapper(from: string, to: string) {
  if (!validPath(from) || !validPath(to)) throw new Error('Invalid milestone migration path.');
  return (value: string) =>
    value === from || value.startsWith(`${from}/`) ? `${to}${value.slice(from.length)}` : value;
}

export function createMilestoneStore(options: MilestoneServiceOptions) {
  let store: MilestoneStore = { version: 1, milestones: [] };
  let initialized = false;
  let queued: Promise<unknown> = Promise.resolve();
  const now = options.now ?? (() => new Date());
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queued.then(operation);
    queued = result.catch(() => undefined);
    return result;
  };
  async function load() {
    if (!initialized) {
      store = validateMilestoneStore(await options.readStore());
      initialized = true;
    }
  }
  async function normalizeTasks(
    tasks: unknown,
    existing: MilestoneTaskAssociation[] = [],
  ): Promise<MilestoneTaskAssociation[]> {
    if (!Array.isArray(tasks) || tasks.length > 1000 || !tasks.every(validTaskAssociation)) {
      throw new Error('Invalid milestone task associations.');
    }
    const seen = new Set<string>();
    const currentTasks = await options.getTasks();
    const written: Array<{ path: string; before: string }> = [];
    try {
      const normalized: MilestoneTaskAssociation[] = [];
      for (const reference of tasks) {
        const key = `${reference.path}\0${reference.taskId}`;
        if (seen.has(key)) throw new Error('A task can only be associated once.');
        seen.add(key);
        let task = currentTasks.find(
          (candidate) =>
            candidate.path === reference.path &&
            (candidate.id === reference.taskId || candidate.taskId === reference.taskId),
        );
        if (!task) {
          if (existing.some((item) => item.path === reference.path && item.taskId === reference.taskId)) {
            normalized.push({ ...reference });
            continue;
          }
          throw new Error('The milestone task no longer exists.');
        }
        if (task.taskId) {
          normalized.push({ path: task.path, taskId: task.taskId });
          continue;
        }
        if (task.htmlTask || !task.line) throw new Error('The task does not have a stable identity.');
        const before = await options.readNote(task.path);
        const lines = before.split(/\r?\n/);
        const line = lines[task.line - 1];
        if (line === undefined || !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
          throw new Error('The task changed before its identity could be saved.');
        }
        const id = randomUUID();
        lines[task.line - 1] = `${line.replace(/\s+$/, '')} <!-- a11y-task-id:${id} -->`;
        await options.saveNote(task.path, lines.join('\n'), before);
        written.push({ path: task.path, before });
        normalized.push({ path: task.path, taskId: id });
        task = { ...task, taskId: id };
      }
      return normalized;
    } catch (error) {
      for (const item of written.reverse()) {
        await options.readNote(item.path)
          .then((current) => options.saveNote(item.path, item.before, current))
          .catch(() => undefined);
      }
      throw error;
    }
  }
  function inputRecord(value: unknown, id: string, createdAt: string, updatedAt: string): Omit<MilestoneRecord, 'tasks'> & {
    tasks?: unknown;
  } {
    if (!object(value)) throw new Error('Invalid milestone.');
    const { title, dueDate, status, notePaths = [], tasks = [] } = value as Partial<NewMilestone>;
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 500 ||
      !validDate(dueDate) ||
      !['planned', 'active', 'completed', 'cancelled'].includes(status as string) ||
      !Array.isArray(notePaths) ||
      notePaths.length > 1000 ||
      !notePaths.every(validPath) ||
      new Set(notePaths).size !== notePaths.length
    ) {
      throw new Error('Enter a title, valid due date, status, and note associations.');
    }
    return {
      id,
      title: title.trim(),
      dueDate,
      status: status as MilestoneStatus,
      notePaths: [...notePaths],
      tasks,
      createdAt,
      updatedAt,
    };
  }
  async function present() {
    const tasks = await options.getTasks();
    return store.milestones.map((milestone) => ({
      ...milestone,
      notePaths: [...milestone.notePaths],
      tasks: milestone.tasks.map((task) => ({ ...task })),
      progress: milestoneProgress(milestone.tasks, tasks),
    }));
  }
  async function persist(next: MilestoneStore) {
    await options.writeStore(next);
    store = next;
  }
  return {
    getMilestones: () =>
      serial(async () => {
        await load();
        return present();
      }),
    createMilestone: (value: NewMilestone) =>
      serial(async () => {
        await load();
        const nowIso = now().toISOString();
        const record = inputRecord(value, randomUUID(), nowIso, nowIso);
        for (const note of record.notePaths) await options.validateNote(note);
        const tasks = await normalizeTasks(record.tasks);
        const { tasks: _inputTasks, ...base } = record;
        await persist(validateMilestoneStore({ version: 1, milestones: [...store.milestones, { ...base, tasks }] }));
        return (await present()).find((item) => item.id === record.id)!;
      }),
    updateMilestone: (id: string, update: MilestoneUpdate) =>
      serial(async () => {
        await load();
        if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id) || !object(update)) {
          throw new Error('Invalid milestone update.');
        }
        const existing = store.milestones.find((item) => item.id === id);
        if (!existing) throw new Error('Milestone no longer exists.');
        const record = inputRecord({ ...existing, ...update }, id, existing.createdAt, now().toISOString());
        for (const note of record.notePaths) {
          if (!existing.notePaths.includes(note)) await options.validateNote(note);
        }
        const tasks = await normalizeTasks(record.tasks, existing.tasks);
        const { tasks: _inputTasks, ...base } = record;
        await persist(
          validateMilestoneStore({
            version: 1,
            milestones: store.milestones.map((item) => (item.id === id ? { ...base, tasks } : item)),
          }),
        );
        return (await present()).find((item) => item.id === id)!;
      }),
    deleteMilestone: (id: string) =>
      serial(async () => {
        await load();
        if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) throw new Error('Invalid milestone.');
        if (!store.milestones.some((item) => item.id === id)) throw new Error('Milestone no longer exists.');
        await persist({ version: 1, milestones: store.milestones.filter((item) => item.id !== id) });
      }),
    migratePaths: (from: string, to: string) =>
      serial(async () => {
        await load();
        const migrate = pathMapper(from, to);
        const milestones = store.milestones.map((milestone) => ({
          ...milestone,
          notePaths: milestone.notePaths.map(migrate),
          tasks: milestone.tasks.map((task) => ({ ...task, path: migrate(task.path) })),
        }));
        await persist(validateMilestoneStore({ version: 1, milestones }));
      }),
  };
}
