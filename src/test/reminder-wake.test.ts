// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  userData: '',
  notificationsSupported: true,
  notifications: [] as unknown[],
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => mock.userData,
    getAppPath: () => '/fake/app',
    isPackaged: false,
    on: () => undefined,
  },
  ipcMain: { handle: () => undefined },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
  },
  protocol: { handle: () => undefined },
  Notification: class {
    constructor() {
      mock.notifications.push(this);
    }
    on() {}
    show() {}
    static isSupported() {
      return mock.notificationsSupported;
    }
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    trashItem: vi.fn(async () => undefined),
  },
}));

const DUE = '2000-01-01T00:00:00.000Z';
const FUTURE = '2100-01-01T00:00:00.000Z';

describe('reminder wake launch', () => {
  let temporary = '';
  let library = '';
  let snapshotFile = '';

  async function writeSnapshot(entries: Array<{ id: string; scheduledAt: string; kind: string; title?: string }>) {
    await mkdir(path.join(library, '.a11ynotebook'), { recursive: true });
    await writeFile(snapshotFile, JSON.stringify({ version: 1, entries }), 'utf8');
  }

  async function readSnapshot(): Promise<Array<{ id: string }>> {
    return (JSON.parse(await readFile(snapshotFile, 'utf8')) as { entries: Array<{ id: string }> }).entries;
  }

  beforeEach(async () => {
    temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'a11y-wake-')));
    mock.userData = path.join(temporary, 'app');
    library = path.join(temporary, 'library');
    snapshotFile = path.join(library, '.a11ynotebook', 'locked-due.json');
    mock.notificationsSupported = true;
    mock.notifications = [];
    await mkdir(mock.userData, { recursive: true });
    await mkdir(library, { recursive: true });
    await writeFile(
      path.join(mock.userData, 'recent-vault.json'),
      JSON.stringify({
        lastOpened: library,
        recent: [{ path: library, name: 'library', lastOpenedAt: '2026-11-01T00:00:00.000Z' }],
      }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  async function runWake() {
    const { setupVaultIpc } = await import('../../electron/vault/ipc');
    const { runReminderWake } = setupVaultIpc(
      () => true,
      () => undefined,
      () => undefined,
    );
    return runReminderWake();
  }

  async function runWakeWithFocus() {
    const { setupVaultIpc } = await import('../../electron/vault/ipc');
    const { runReminderWake, getReminderWakeFocus } = setupVaultIpc(
      () => true,
      () => undefined,
      () => undefined,
    );
    const hadDue = await runReminderWake();
    return { hadDue, focus: getReminderWakeFocus() };
  }

  it('reports due reminders, shows a notification, and drops fired entries', async () => {
    await writeSnapshot([
      { id: 'reminder-1', scheduledAt: DUE, kind: 'reminder' },
      { id: 'card-1', scheduledAt: DUE, kind: 'flashcard' },
      { id: 'reminder-2', scheduledAt: FUTURE, kind: 'reminder' },
    ]);
    expect(await runWake()).toBe(true);
    expect(mock.notifications).toHaveLength(1);
    expect((await readSnapshot()).map((entry) => entry.id)).toEqual(['reminder-2']);
  });

  it('reports due reminders even when native notifications are unsupported', async () => {
    mock.notificationsSupported = false;
    await writeSnapshot([{ id: 'reminder-1', scheduledAt: DUE, kind: 'reminder' }]);
    expect(await runWake()).toBe(true);
    expect(mock.notifications).toHaveLength(0);
    expect(await readSnapshot()).toEqual([]);
  });

  it('reports nothing due and leaves the snapshot untouched when all entries are future', async () => {
    await writeSnapshot([{ id: 'reminder-2', scheduledAt: FUTURE, kind: 'reminder' }]);
    const before = await readFile(snapshotFile, 'utf8');
    expect(await runWake()).toBe(false);
    expect(mock.notifications).toHaveLength(0);
    expect(await readFile(snapshotFile, 'utf8')).toBe(before);
  });

  it('reports nothing due when no recent library is recorded', async () => {
    await rm(path.join(mock.userData, 'recent-vault.json'), { force: true });
    await writeSnapshot([{ id: 'reminder-1', scheduledAt: DUE, kind: 'reminder' }]);
    expect(await runWake()).toBe(false);
    expect(mock.notifications).toHaveLength(0);
  });

  it('reports nothing due when the snapshot is corrupt', async () => {
    await mkdir(path.join(library, '.a11ynotebook'), { recursive: true });
    await writeFile(snapshotFile, 'not json', 'utf8');
    expect(await runWake()).toBe(false);
    expect(mock.notifications).toHaveLength(0);
  });

  it('records the earliest-due reminder as the wake focus target', async () => {
    await writeSnapshot([
      { id: 'reminder-late', scheduledAt: '2000-06-01T00:00:00.000Z', kind: 'reminder' },
      { id: 'reminder-early', scheduledAt: '2000-01-01T00:00:00.000Z', kind: 'reminder' },
      { id: 'card-early', scheduledAt: '1999-01-01T00:00:00.000Z', kind: 'flashcard' },
    ]);
    const { hadDue, focus } = await runWakeWithFocus();
    expect(hadDue).toBe(true);
    expect(focus).toEqual({ libraryPath: library, reminderId: 'reminder-early' });
  });

  it('records no focus target when only flashcards are due', async () => {
    await writeSnapshot([{ id: 'card-1', scheduledAt: DUE, kind: 'flashcard' }]);
    const { hadDue, focus } = await runWakeWithFocus();
    expect(hadDue).toBe(true);
    expect(focus).toBeNull();
  });

  it('records no focus target when nothing is due', async () => {
    await writeSnapshot([{ id: 'reminder-2', scheduledAt: FUTURE, kind: 'reminder' }]);
    const { hadDue, focus } = await runWakeWithFocus();
    expect(hadDue).toBe(false);
    expect(focus).toBeNull();
  });

  it('records no focus target when the snapshot is corrupt', async () => {
    await mkdir(path.join(library, '.a11ynotebook'), { recursive: true });
    await writeFile(snapshotFile, 'not json', 'utf8');
    const { hadDue, focus } = await runWakeWithFocus();
    expect(hadDue).toBe(false);
    expect(focus).toBeNull();
  });
});
