// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderService, parseTaskReminders, validateReminderStore } from '../../electron/vault/reminders';
import { parseReminderDate, snoozeUntil, type ReminderStore } from '../shared/reminders';

function fixture(content = '- [ ] Read remind:2026-10-03 09:00') {
  let persisted: unknown = null;
  let notes = [{ path: 'Study.md', content }];
  const notify = vi.fn();
  const writeStore = vi.fn(async (store: ReminderStore) => { persisted = structuredClone(store); });
  const getNotes = vi.fn(async () => notes);
  const options = {
    readStore: async () => persisted,
    writeStore,
    getNotes,
    validateNote: vi.fn(async (path: string) => {
      if (!notes.some((note) => note.path === path)) throw new Error('Missing note.');
    }),
    notify,
    onError: vi.fn(),
  };
  return {
    service: createReminderService(options), options, notify, writeStore, getNotes,
    setNotes: (next: typeof notes) => { notes = next; },
    persisted: () => persisted,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 3, 10, 0));
});
afterEach(() => vi.useRealTimers());

describe('reminder parsing and validation', () => {
  it('parses both markers, retains source lines, and ignores code fences and malformed dates', () => {
    const tasks = parseTaskReminders([
      '- [ ] Read remind:2026-10-03 09:00',
      '- [X] Submit ⏰ 2026-10-05 12:30',
      '- [ ] Bad remind:2026-02-30 10:00',
      '- [ ] Bad remind:2026-10-03 25:00',
      '- [ ] Bad remind:2026-10-03 10:00:30',
      '```md', '- [ ] Example remind:2026-10-03 09:00', '```',
    ].join('\n'), 'Study.md');
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: 'Read', line: 1, complete: false });
    expect(tasks[1]).toMatchObject({ title: 'Submit', line: 2, complete: true });
    expect(parseTaskReminders('- [ ] Read remind:2026-10-03 09:00', '../Study.md')).toEqual([]);
  });

  it('rejects impossible calendar dates and timestamps rather than normalizing them', () => {
    for (const value of ['2026-02-29 10:00', '2026-04-31 10:00', '2026-00-01 10:00', '2026-10-03 10:60', '2026-02-30T10:00:00Z', '2026-10-03T10:00:00+24:00']) {
      expect(parseReminderDate(value)).toBeNull();
    }
    expect(parseReminderDate('2028-02-29 10:00')).toBeInstanceOf(Date);
    expect(parseReminderDate('2026-10-03T10:00:00.000Z')?.toISOString()).toBe('2026-10-03T10:00:00.000Z');
    expect(() => validateReminderStore({ version: 1, standalone: [], states: { bad: {} } })).toThrow();
    expect(validateReminderStore(null)).toEqual({ version: 1, standalone: [], states: {} });
  });
});

describe('vault reminder scheduler', () => {
  it('fires overdue reminders on startup once, persisting before notifying across restarts', async () => {
    const f = fixture();
    await f.service.initialize();
    expect(f.notify).toHaveBeenCalledOnce();
    expect(f.writeStore.mock.invocationCallOrder[0]).toBeLessThan(f.notify.mock.invocationCallOrder[0]);
    await f.service.refresh();
    f.service.stop();
    const restarted = createReminderService(f.options);
    expect(await restarted.initialize()).toMatchObject([{ status: 'fired' }]);
    expect(f.notify).toHaveBeenCalledOnce();
    restarted.stop();
  });

  it('never fires completed tasks, including a task completed before its timer wakes', async () => {
    const f = fixture('- [x] Done remind:2026-10-03 09:00\n- [ ] Later ⏰ 2026-10-03 10:05');
    await f.service.initialize();
    expect(f.notify).not.toHaveBeenCalled();
    f.setNotes([{ path: 'Study.md', content: '- [x] Done remind:2026-10-03 09:00\n- [x] Later ⏰ 2026-10-03 10:05' }]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(f.notify).not.toHaveBeenCalled();
    expect(await f.service.getReminders()).toEqual([]);
    f.service.stop();
  });

  it('snoozes fired tasks, persists snooze state, dismisses, and supports all durations', async () => {
    const f = fixture();
    const [item] = await f.service.initialize();
    const [snoozed] = await f.service.snoozeReminder(item.id, 5);
    expect(Date.parse(snoozed.scheduledAt)).toBe(Date.now() + 5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(f.notify).toHaveBeenCalledTimes(2);
    for (const duration of [15, 60] as const) {
      const [next] = await f.service.snoozeReminder(item.id, duration);
      expect(Date.parse(next.scheduledAt)).toBe(Date.now() + duration * 60_000);
    }
    const [tomorrow] = await f.service.snoozeReminder(item.id, 'tomorrow');
    expect(Date.parse(tomorrow.scheduledAt)).toBe(snoozeUntil(new Date(), 'tomorrow').getTime());
    await f.service.dismissReminder(item.id);
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60_000);
    expect(f.notify).toHaveBeenCalledTimes(2);
    f.service.stop();
    const restarted = createReminderService(f.options);
    expect(await restarted.initialize()).toMatchObject([{ status: 'dismissed' }]);
    expect(f.notify).toHaveBeenCalledTimes(2);
    restarted.stop();
  });

  it('combines validated standalone reminders and task reminders, rejecting unsafe inputs', async () => {
    const f = fixture('- [ ] Read remind:2026-10-03 11:00');
    await f.service.initialize();
    const items = await f.service.createReminder({ title: 'Appointment', path: 'Study.md', scheduledAt: '2026-10-03 10:05' });
    expect(items.map((item) => item.source)).toEqual(['standalone', 'task']);
    await expect(f.service.createReminder({ title: 'Bad', path: '../Study.md', scheduledAt: '2026-10-03 10:05' })).rejects.toThrow();
    await expect(f.service.createReminder({ title: 'Bad', path: 'Study.md', scheduledAt: '2026-02-30 10:05' })).rejects.toThrow();
    await expect(f.service.createReminder({ title: 'Bad', path: 'Missing.md', scheduledAt: '2026-10-03 10:05' })).rejects.toThrow('Missing');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Appointment', status: 'fired' }));
    expect(f.persisted()).toMatchObject({ version: 1, standalone: [{ status: 'fired' }] });
    f.service.stop();
  });

  it('caps long timeouts without polling or firing early and cancels on vault switch', async () => {
    const f = fixture('- [ ] Future remind:2027-10-03 10:00');
    const setTimeout = vi.fn((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay));
    const service = createReminderService({ ...f.options, setTimeout });
    await service.initialize();
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2_147_483_647);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(f.getNotes).toHaveBeenCalledTimes(2);
    expect(f.notify).not.toHaveBeenCalled();
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
    await expect(service.refresh()).rejects.toThrow('not active');
  });

  it('cancels notifications when stopped during an in-flight persistence operation', async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    const service = createReminderService({
      ...f.options,
      writeStore: () => new Promise<void>((resolve) => { finish = resolve; }),
    });
    const initialized = service.initialize();
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.stop();
    finish?.();
    await initialized;
    expect(f.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains notification failures and retries failed background reads without unhandled rejections', async () => {
    const f = fixture('- [ ] Later remind:2026-10-03 10:05');
    f.notify.mockRejectedValue(new Error('Notifications unavailable'));
    await f.service.initialize();
    f.getNotes.mockRejectedValueOnce(new Error('Read failed'));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(f.options.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Read failed' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.notify).toHaveBeenCalledOnce();
    expect(f.options.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Notifications unavailable' }));
    await f.service.refresh();
    expect(f.notify).toHaveBeenCalledOnce();
    f.service.stop();
  });

  it('does not publish unchanged snapshots when event consumers query the service', async () => {
    const f = fixture('- [ ] Later remind:2026-10-03 10:05');
    const onChange = vi.fn();
    const service = createReminderService({ ...f.options, onChange });
    await service.initialize();
    await service.getReminders();
    await service.getReminders();
    expect(onChange).toHaveBeenCalledOnce();
    service.stop();
  });

  it('never notifies before successful persistence and safely contains failing error reporters', async () => {
    const f = fixture('- [ ] Later remind:2026-10-03 10:05');
    const writeStore = vi.fn().mockRejectedValue(new Error('Disk full'));
    const onError = vi.fn().mockRejectedValue(new Error('Reporter unavailable'));
    const service = createReminderService({ ...f.options, writeStore, onError });
    await service.initialize();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(f.notify).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Disk full' }));
    service.stop();
  });

  it('rejects malformed metadata at startup and never schedules it', async () => {
    const f = fixture();
    const service = createReminderService({ ...f.options, readStore: async () => ({ version: 99 }) });
    await expect(service.initialize()).rejects.toThrow('Invalid reminder metadata');
    expect(f.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    service.stop();
  });

  it('migrates stopped reminder metadata after a note move without refiring completed deliveries', async () => {
    const f = fixture();
    const [task] = await f.service.initialize();
    await f.service.createReminder({ title: 'Meeting', path: 'Study.md', scheduledAt: '2026-10-03 11:00' });
    f.service.stop();
    f.setNotes([{ path: 'Notes/Study.md', content: '- [ ] Read remind:2026-10-03 09:00' }]);
    const moved = await f.service.migratePaths('Study.md', 'Notes/Study.md');
    expect(moved).toMatchObject([
      { path: 'Notes/Study.md', source: 'task', status: 'fired' },
      { path: 'Notes/Study.md', source: 'standalone' },
    ]);
    expect(moved[0].id).not.toBe(task.id);
    const restarted = createReminderService(f.options);
    const loaded = await restarted.initialize();
    expect(loaded[0]).toMatchObject({ source: 'task', path: 'Notes/Study.md', status: 'fired' });
    expect(f.notify).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(f.notify).toHaveBeenCalledTimes(2);
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Meeting', path: 'Notes/Study.md' }));
    restarted.stop();
  });

  it('migrates folder descendants while preserving snoozes and similarly prefixed folders', async () => {
    const f = fixture('');
    f.setNotes([
      { path: 'Notes/Study.md', content: '- [ ] Read remind:2026-10-03 09:00' },
      { path: 'Notes2/Study.md', content: '' },
    ]);
    const [task] = await f.service.initialize();
    await f.service.snoozeReminder(task.id, 15);
    await f.service.createReminder({ title: 'Unmoved', path: 'Notes2/Study.md', scheduledAt: '2026-10-03 11:00' });
    f.setNotes([
      { path: 'School/Study.md', content: '- [ ] Read remind:2026-10-03 09:00' },
      { path: 'Notes2/Study.md', content: '' },
    ]);
    const moved = await f.service.migratePaths('Notes', 'School');
    expect(moved[0]).toMatchObject({ path: 'School/Study.md', status: 'pending' });
    expect(Date.parse(moved[0].scheduledAt)).toBe(Date.now() + 15 * 60_000);
    expect(moved[1]).toMatchObject({ path: 'Notes2/Study.md' });
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'School/Study.md' }));
    await expect(f.service.migratePaths('../School', 'Elsewhere')).rejects.toThrow('migration path');
    f.service.stop();
  });

  it('serializes path relocation with queued timer and watcher refreshes', async () => {
    const f = fixture();
    const [task] = await f.service.initialize();
    await f.service.snoozeReminder(task.id, 5);
    let finish: (() => void) | undefined;
    const moved = f.service.withPathMigration('Study.md', 'Moved.md', async () => {
      f.setNotes([{ path: 'Moved.md', content: '- [ ] Read remind:2026-10-03 09:00' }]);
      await new Promise<void>((resolve) => { finish = resolve; });
      return 'relocated';
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const refreshed = f.service.refresh();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(f.notify).toHaveBeenCalledOnce();
    finish?.();
    await expect(moved).resolves.toBe('relocated');
    const items = await refreshed;
    expect(items).toMatchObject([{ path: 'Moved.md', status: 'fired' }]);
    expect(f.notify).toHaveBeenCalledTimes(2);
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'Moved.md' }));
    f.service.stop();
  });

  it('leaves metadata unchanged when relocation fails and validates before calling the operation', async () => {
    const f = fixture();
    await f.service.initialize();
    const snapshot = structuredClone(f.persisted());
    await expect(f.service.withPathMigration('Study.md', 'Moved.md', async () => {
      throw new Error('Cannot move');
    })).rejects.toThrow('Cannot move');
    expect(f.persisted()).toEqual(snapshot);
    const operation = vi.fn(async () => 'should not run');
    await expect(f.service.withPathMigration('../Study.md', 'Moved.md', operation)).rejects.toThrow('migration path');
    expect(operation).not.toHaveBeenCalled();
    expect(await f.service.getReminders()).toMatchObject([{ path: 'Study.md', status: 'fired' }]);
    f.service.stop();
  });

  it('stops the scheduler if metadata persistence fails after relocation', async () => {
    const f = fixture();
    await f.service.initialize();
    f.writeStore.mockRejectedValueOnce(new Error('Disk full'));
    await expect(f.service.withPathMigration('Study.md', 'Moved.md', async () => {
      f.setNotes([{ path: 'Moved.md', content: '- [ ] Read remind:2026-10-03 09:00' }]);
      return 'relocated';
    })).rejects.toThrow('Disk full');
    await expect(f.service.refresh()).rejects.toThrow('not active');
    expect(f.notify).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
