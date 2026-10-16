// @vitest-environment node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  root: '',
  userData: '',
  savePath: '',
  importSource: '',
  cancel: false,
  saveGate: undefined as undefined | (() => Promise<void>),
  failRecent: false,
  chooser: vi.fn(async () => undefined),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mock.userData, on: (_event: string, callback: () => void) => mock.quit.push(callback) },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      mock.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async (options: { properties: string[] }) => ({
      canceled: false,
      filePaths: [options.properties.includes('openFile') ? mock.importSource : mock.root],
    }),
    showSaveDialog: async () => {
      await mock.saveGate?.();
      return { canceled: mock.cancel, filePath: mock.savePath };
    },
    showMessageBox: async () => ({ response: 0 }),
  },
  protocol: { handle: vi.fn() },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  shell: { openPath: vi.fn(async () => '') },
}));
vi.mock('../../electron/vault/open-with', () => ({ openWithChooser: mock.chooser }));
vi.mock('../../electron/vault/watcher', () => ({
  createVaultWatcher: async () => ({ dispose: async () => undefined }),
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (mock.failRecent && String(args[0]).endsWith('recent-vault.json')) throw new Error('Recent write failed');
      return actual.writeFile(...args);
    },
  };
});

let workspace: string;
const trusted = {};
const invoke = <T = unknown>(channel: string, ...args: unknown[]) =>
  mock.handlers.get(channel)!(trusted, ...args) as Promise<T>;
beforeEach(async () => {
  vi.resetModules();
  mock.handlers.clear();
  mock.quit = [];
  mock.cancel = false;
  mock.failRecent = false;
  mock.saveGate = undefined;
  mock.importSource = '';
  mock.chooser.mockClear();
  workspace = path.join(process.cwd(), `.vault-ipc-${randomUUID()}`);
  mock.root = path.join(workspace, 'Old library');
  mock.userData = path.join(workspace, 'app');
  mock.savePath = path.join(workspace, 'New library');
  await mkdir(mock.root, { recursive: true });
  const { setupVaultIpc } = await import('../../electron/vault/ipc');
  setupVaultIpc(
    (event) => event === trusted,
    () => undefined,
    () => undefined,
  );
  await invoke(IPC_CHANNELS.vaultOpen);
});
afterEach(async () => {
  mock.quit.forEach((callback) => callback());
  await new Promise((resolve) => setTimeout(resolve, 30));
  await rm(workspace, { recursive: true, force: true });
});

describe('creation IPC authorization and dialogs', () => {
  it('creates a fresh library and leaves the old folder contents untouched', async () => {
    await writeFile(path.join(mock.root, 'Keep.md'), '# Keep');
    const library = await invoke<VaultInfo>(IPC_CHANNELS.vaultCreateLibrary);
    expect(library.path).toBe(mock.savePath);
    expect(library.entries).toEqual([]);
    expect(await readFile(path.join(mock.root, 'Keep.md'), 'utf8')).toBe('# Keep');
    expect(JSON.parse(await readFile(path.join(mock.userData, 'recent-vault.json'), 'utf8')).lastOpened).toBe(
      mock.savePath,
    );
  });

  it('does not switch or adopt an existing folder on cancel, collision, or initialization failure', async () => {
    mock.cancel = true;
    expect(await invoke(IPC_CHANNELS.vaultCreateLibrary)).toBeNull();
    mock.cancel = false;
    mock.savePath = mock.root;
    await expect(invoke(IPC_CHANNELS.vaultCreateLibrary)).rejects.toThrow();
    mock.savePath = path.join(workspace, 'Failed library');
    mock.failRecent = true;
    await expect(invoke(IPC_CHANNELS.vaultCreateLibrary)).rejects.toThrow('Recent write failed');
    expect((await invoke<VaultInfo>(IPC_CHANNELS.vaultGet)).path).toBe(mock.root);
  });

  it('rejects untrusted callers and revokes a pending library dialog when the active library changes', async () => {
    await expect(mock.handlers.get(IPC_CHANNELS.vaultCreateLibrary)!({})).rejects.toThrow('Untrusted');
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.saveGate = () => {
      entered();
      return gate;
    };
    const creating = invoke(IPC_CHANNELS.vaultCreateLibrary);
    await waiting;
    await invoke(IPC_CHANNELS.vaultOpen);
    release();
    await expect(creating).rejects.toThrow('lock state changed');
  });

  it('creates tasks through the service and passes only a checked current-vault file to Open With', async () => {
    const tasks = await invoke<Array<{ path: string; text: string }>>(IPC_CHANNELS.vaultCreateTask, {
      text: 'Task from IPC',
    });
    expect(tasks[0].text).toBe('Task from IPC');
    await invoke(IPC_CHANNELS.vaultOpenWith, tasks[0].path);
    expect(mock.chooser).toHaveBeenCalledWith(path.join(mock.root, tasks[0].path));
    await expect(invoke(IPC_CHANNELS.vaultOpenWith, '../outside.md')).rejects.toThrow();
    await expect(invoke(IPC_CHANNELS.vaultCreateTask, { text: 'Bad\nTask' })).rejects.toThrow('single-line');
  });

  it('synchronizes task reminder markers immediately after task creation', async () => {
    const tasks = await invoke<Array<{ path: string }>>(IPC_CHANNELS.vaultCreateTask, {
      text: 'Review accessibility remind:2099-01-01 09:00',
    });
    const reminders = await invoke<Array<{ source: string; path: string; title: string }>>(IPC_CHANNELS.vaultReminders);
    expect(reminders).toContainEqual(
      expect.objectContaining({
        source: 'task',
        path: tasks[0].path,
        title: 'Review accessibility',
      }),
    );
  });

  it('imports an existing file through narrow IPC without changing the original', async () => {
    const content = '<h1>Imported</h1><script>bad()</script>';
    await writeFile(path.join(mock.root, 'External.html'), content);
    const result = await invoke<{ vault: VaultInfo; path: string }>(IPC_CHANNELS.vaultImportEntry, 'External.html');
    const imported = result.vault.entries.find((entry) => entry.provenance === 'imported')!;
    expect(result.path).toBe(imported.path);
    expect(imported.kind).toBe('note');
    expect(await readFile(path.join(mock.root, imported.path), 'utf8')).not.toContain('<script>');
    expect(await readFile(path.join(mock.root, 'External.html'), 'utf8')).toBe(content);
  });

  it('classifies compatible files selected by the existing importFile dialog as imported', async () => {
    const original = '<h1>Selected HTML</h1><script>unsafe()</script>';
    mock.importSource = path.join(workspace, 'Selected.html');
    await writeFile(mock.importSource, original);
    await invoke(IPC_CHANNELS.vaultCreateNotebook, 'Destination');
    const result = await invoke<VaultInfo>(IPC_CHANNELS.vaultImport, 'Destination');
    expect(result.entries[0].children?.[0]).toMatchObject({
      path: 'Destination/Selected.html',
      kind: 'note',
      provenance: 'imported',
    });
    expect(await readFile(path.join(mock.root, 'Destination/Selected.html'), 'utf8')).not.toContain('<script>');
    expect(await readFile(mock.importSource, 'utf8')).toBe(original);
  });

  it('rejects all new operations when locked, including a dialog opened before locking', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'strong library password');
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.saveGate = () => {
      entered();
      return gate;
    };
    const creating = invoke(IPC_CHANNELS.vaultCreateLibrary);
    await waiting;
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    release();
    await expect(creating).rejects.toThrow('Unlock');
    for (const [channel, input] of [
      [IPC_CHANNELS.vaultCreateLibrary, undefined],
      [IPC_CHANNELS.vaultCreateTask, { text: 'blocked' }],
      [IPC_CHANNELS.vaultImportEntry, 'External.html'],
      [IPC_CHANNELS.vaultOpenWith, 'External.html'],
    ] as const)
      await expect(invoke(channel, input)).rejects.toThrow('Unlock');
  });
});
