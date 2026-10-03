// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  root: '',
  userData: '',
  confirm: 1,
  protocol: undefined as undefined | ((request: { url: string }) => Promise<Response>),
}));

vi.mock('electron', () => ({
  app: { getPath: () => mock.userData, on: (_name: string, callback: () => void) => mock.quit.push(callback) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mock.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [mock.root] }),
    showMessageBox: async () => ({ response: mock.confirm }),
  },
  protocol: {
    handle: (_scheme: string, handler: (request: { url: string }) => Promise<Response>) => {
      mock.protocol = handler;
    },
  },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => ''), trashItem: vi.fn(async () => undefined) },
}));

let temporary = '';
const trusted = {};
const invoke = (channel: string, ...args: unknown[]) => mock.handlers.get(channel)!(trusted, ...args);

beforeEach(async () => {
  vi.resetModules();
  mock.handlers.clear();
  mock.quit = [];
  mock.confirm = 1;
  temporary = await mkdtemp(path.join(os.tmpdir(), 'a11y-ipc-'));
  mock.root = path.join(temporary, 'vault');
  mock.userData = path.join(temporary, 'app');
  await mkdir(mock.root);
  await mkdir(mock.userData);
  await mkdir(path.join(mock.root, 'Folder'));
  await writeFile(path.join(mock.root, 'Topic.md'), '# Topic\n\nalpha #research\n');
  await writeFile(path.join(mock.root, 'Reference.md'), '[[Topic|subject]] [Topic](Topic.md)');
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
  await rm(temporary, { recursive: true, force: true });
});

describe('extended vault IPC integration', () => {
  it('rejects untrusted senders on every registered channel', async () => {
    for (const handler of mock.handlers.values()) await expect(handler({})).rejects.toThrow('Untrusted');
  });
  it('repairs links and migrates annotation paths on a confirmed move', async () => {
    const annotation = (await invoke(IPC_CHANNELS.vaultAnnotationAdd, {
      path: 'Topic.md',
      anchor: { quote: 'Topic', prefix: '', suffix: '', start: 0, end: 5 },
      color: 'yellow',
      label: 'Important',
      comment: '',
    })) as { id: string };
    await invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md');
    expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toBe(
      '[[Folder/New|subject]] [Topic](Folder/New.md)',
    );
    expect(await invoke(IPC_CHANNELS.vaultAnnotations, 'Folder/New.md')).toEqual([
      expect.objectContaining({ id: annotation.id, path: 'Folder/New.md' }),
    ]);
    expect(await invoke(IPC_CHANNELS.vaultSearch, { text: 'alpha', tag: 'research' })).toEqual([
      expect.objectContaining({ path: 'Folder/New.md' }),
    ]);
  });
  it('leaves source notes untouched when the repair confirmation is cancelled', async () => {
    mock.confirm = 0;
    await invoke(IPC_CHANNELS.vaultRename, 'Topic.md', 'New.md');
    expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toContain('[[Topic|subject]]');
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
  });
  it('rejects stale saves and invalid paths without overwriting disk', async () => {
    await expect(invoke(IPC_CHANNELS.vaultSaveNote, 'Topic.md', 'mine', 'old baseline')).rejects.toThrow(
      'changed on disk',
    );
    await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', '../outside.md')).rejects.toThrow();
    await expect(invoke(IPC_CHANNELS.vaultReadAttachment, '../outside.txt')).rejects.toThrow();
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
  });
  it('serves only validated raster images through the protocol', async () => {
    await writeFile(path.join(mock.root, 'Photo.png'), new Uint8Array([1, 2, 3]));
    expect((await mock.protocol!({ url: 'vault-file://attachment/Photo.png' })).status).toBe(200);
    expect((await mock.protocol!({ url: 'vault-file://attachment/Topic.md' })).status).toBe(415);
    expect((await mock.protocol!({ url: 'vault-file://attachment/%2e%2e/Photo.png' })).status).toBe(404);
    await symlink(path.join(mock.root, 'Photo.png'), path.join(mock.root, 'Escape.png'));
    expect((await mock.protocol!({ url: 'vault-file://attachment/Escape.png' })).status).toBe(404);
  });
  it('persists assets and schedules but rejects changed-deck ratings', async () => {
    await invoke(IPC_CHANNELS.vaultAssetCreate, 'Study.cards.md', 'Q :: A\n');
    const schedule = { repetitions: 1, interval: 1, ease: 2.5, due: '2026-10-04' };
    await invoke(IPC_CHANNELS.vaultFlashcardsSave, 'Study.cards.md', 'card-1', schedule, 'Q :: A\n');
    expect(await invoke(IPC_CHANNELS.vaultFlashcardsGet, 'Study.cards.md')).toEqual({ 'card-1': schedule });
    await expect(
      invoke(IPC_CHANNELS.vaultFlashcardsSave, 'Study.cards.md', 'card-1', schedule, 'wrong'),
    ).rejects.toThrow('deck changed');
    await expect(invoke(IPC_CHANNELS.vaultAssetSave, 'Study.cards.md', 'invalid', 'Q :: A\n')).rejects.toThrow();
  });
});
