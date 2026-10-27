// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildReminderTaskXml,
  createScheduledReminderManager,
  escapeXml,
  nextUpcoming,
  planWake,
  taskBoundary,
} from '../../electron/scheduled-reminders';
import { serializeDueSnapshot, validateDueSnapshot } from '../../electron/vault/locked-due-store';
import { validateSettings, DEFAULT_SETTINGS } from '../shared/settings';

const entries = [
  { id: 'past', scheduledAt: '2026-10-23T09:00:00.000Z', kind: 'reminder' as const },
  { id: 'soon', scheduledAt: '2026-10-23T15:00:00.000Z', kind: 'reminder' as const },
  { id: 'later', scheduledAt: '2026-10-23T18:30:00.000Z', kind: 'flashcard' as const },
];
const now = new Date('2026-10-23T12:00:00.000Z');

describe('scheduled reminder task', () => {
  it('escapes XML and builds a content-free task definition', () => {
    expect(escapeXml('a&b<c>"d"')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
    const xml = buildReminderTaskXml({
      execute: 'C:\\Program Files\\A11y Notebook\\A11yNotebook.exe',
      args: ['--a11y-reminder-wake'],
      startBoundary: '2026-10-23T08:00:00',
    });
    expect(xml).toContain('<Command>C:\\Program Files\\A11y Notebook\\A11yNotebook.exe</Command>');
    expect(xml).toContain('<Arguments>--a11y-reminder-wake</Arguments>');
    expect(xml).toContain('<StartBoundary>2026-10-23T08:00:00</StartBoundary>');
    expect(xml).not.toContain('Reminder title');
  });

  it('plans triggers and wakes from ids-and-times snapshots', () => {
    expect(nextUpcoming(entries, now)?.id).toBe('soon');
    const plan = planWake(entries, now);
    expect(plan.due.map((entry) => entry.id)).toEqual(['past']);
    expect(plan.remaining.map((entry) => entry.id)).toEqual(['soon', 'later']);
    expect(plan.next?.id).toBe('soon');
    expect(taskBoundary(new Date(2026, 9, 23, 8, 5, 3))).toBe('2026-10-23T08:05:03');
  });

  it('creates and replaces one task through argument arrays, and deletes when nothing is upcoming', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const manager = createScheduledReminderManager({
      platform: 'win32',
      run: async (file, args) => {
        calls.push({ file, args });
        return { code: 0 };
      },
      writeXml: async () => 'task.xml',
      removeFile: async () => undefined,
    });
    await expect(
      manager.sync({ enabled: true, execute: 'app.exe', args: ['--a11y-reminder-wake'], entries, now }),
    ).resolves.toBe(true);
    expect(calls[0]).toEqual({
      file: 'schtasks.exe',
      args: ['/Create', '/TN', 'A11yNotebook Reminders', '/XML', 'task.xml', '/F'],
    });
    calls.length = 0;
    await manager.sync({ enabled: false, execute: 'app.exe', args: [], entries, now });
    expect(calls[0].args.slice(0, 2)).toEqual(['/Delete', '/TN']);
    calls.length = 0;
    await manager.sync({ enabled: true, execute: 'app.exe', args: [], entries: [entries[0]], now });
    expect(calls[0].args[0]).toBe('/Delete');
  });

  it('is a no-op off Windows and tolerates schtasks failures', async () => {
    const run = vi.fn(async () => ({ code: 0 }));
    const posix = createScheduledReminderManager({ platform: 'linux', run, writeXml: async () => 'x' });
    await expect(posix.sync({ enabled: true, execute: 'app', args: [], entries, now })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    const failing = createScheduledReminderManager({
      platform: 'win32',
      run: async () => ({ code: 1 }),
      writeXml: async () => 'task.xml',
      removeFile: async () => undefined,
    });
    await expect(failing.sync({ enabled: true, execute: 'app', args: [], entries, now })).resolves.toBe(false);
  });
});

describe('due snapshot persistence', () => {
  it('validates, dedupes, sorts, and round-trips entries', () => {
    const snapshot = serializeDueSnapshot([
      entries[2],
      entries[1],
      { ...entries[1] },
      { id: 'bad', scheduledAt: 'not-a-date', kind: 'reminder' },
      { id: 'bad-kind', scheduledAt: entries[1].scheduledAt, kind: 'other' as never },
    ]);
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(['soon', 'later']);
    expect(validateDueSnapshot(snapshot)).toEqual(snapshot.entries);
    expect(validateDueSnapshot(null)).toEqual([]);
    expect(validateDueSnapshot({ entries: 'nope' })).toEqual([]);
  });

  it('keeps the backgroundReminders setting boolean with a false default', () => {
    expect(DEFAULT_SETTINGS.backgroundReminders).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, backgroundReminders: true }).backgroundReminders).toBe(true);
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, backgroundReminders: 'yes' as never })).toThrow();
  });

  it('strips snapshot titles by default and keeps them only under the opt-in', () => {
    const titled = { id: 't1', scheduledAt: entries[1].scheduledAt, kind: 'reminder' as const, title: 'Call back' };
    expect(serializeDueSnapshot([titled]).entries).toEqual([
      { id: 't1', scheduledAt: entries[1].scheduledAt, kind: 'reminder' },
    ]);
    expect(serializeDueSnapshot([titled], true).entries).toEqual([titled]);
    expect(validateDueSnapshot({ entries: [titled] })).toEqual([titled]);
    expect(
      validateDueSnapshot({ entries: [{ ...titled, title: 'x'.repeat(501) }] }),
    ).toEqual([{ id: 't1', scheduledAt: entries[1].scheduledAt, kind: 'reminder' }]);
  });

  it('keeps the backgroundReminderTitles setting boolean with a false default', () => {
    expect(DEFAULT_SETTINGS.backgroundReminderTitles).toBe(false);
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, backgroundReminderTitles: true }).backgroundReminderTitles,
    ).toBe(true);
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, backgroundReminderTitles: 'yes' as never })).toThrow();
  });
});
