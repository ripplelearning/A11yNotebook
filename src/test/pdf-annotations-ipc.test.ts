// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc';
import type { NewPdfAnnotation, PdfAnnotation } from '../shared/pdf-annotation';
import { untaggedReport } from './fixtures/pdf-fixtures';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  root: '',
  app: '',
}));
vi.mock('electron', () => ({
  app: { getPath: () => mock.app, on: (_name: string, callback: () => void) => mock.quit.push(callback) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mock.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [mock.root] }),
    showMessageBox: async () => ({ response: 1 }),
  },
  protocol: { handle: vi.fn() },
  shell: { openPath: vi.fn(), trashItem: vi.fn(), showItemInFolder: vi.fn() },
  Notification: { isSupported: () => false },
}));
vi.mock('../../electron/vault/watcher', () => ({
  createVaultWatcher: async () => ({ dispose: async () => undefined }),
}));

const trusted = {};
const invoke = (channel: string, ...args: unknown[]) => mock.handlers.get(channel)!(trusted, ...args);
const input: NewPdfAnnotation = {
  path: 'Research.pdf',
  target: {
    kind: 'pdf',
    documentIdentity: { fingerprint: 'fingerprint', fileHash: 'hash', vaultPath: 'Research.pdf' },
    page: 1,
    canonicalStart: 0,
    canonicalLength: 5,
    exactQuote: 'words',
    normalizedQuote: 'words',
    contextBefore: '',
    contextAfter: '',
    classification: 'exact',
    confidence: 'certain',
  },
  color: 'red',
  label: '',
  comment: 'Study',
};
let folder = '';
beforeEach(async () => {
  vi.resetModules();
  mock.handlers.clear();
  mock.quit = [];
  folder = path.resolve(`.pdf-annotation-ipc-test-${randomUUID()}`);
  mock.root = path.join(folder, 'vault');
  mock.app = path.join(folder, 'app');
  await mkdir(mock.root, { recursive: true });
  await mkdir(mock.app);
  await mkdir(path.join(mock.root, 'Archive'));
  await writeFile(path.join(mock.root, input.path), untaggedReport(1));
  await writeFile(path.join(mock.root, 'Idea.md'), 'words');
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
  await rm(folder, { recursive: true, force: true });
});

describe('PDF annotation IPC security and persistence', () => {
  it('supports explicit CRUD methods and preserves identities when moved', async () => {
    const added = (await invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, input)) as PdfAnnotation;
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([added]);
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotationUpdate, input.path, added.id, { color: 'none' })).toMatchObject({
      color: 'none',
    });
    await invoke(IPC_CHANNELS.vaultMove, input.path, 'Archive/Research.pdf');
    const moved = (await invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Archive/Research.pdf')) as PdfAnnotation[];
    expect(moved[0].target.documentIdentity.vaultPath).toBe('Archive/Research.pdf');
    const saved = JSON.parse(await readFile(path.join(mock.root, '.a11ynotebook', 'annotations.json'), 'utf8'));
    expect(saved.version).toBe(2);
    await invoke(IPC_CHANNELS.vaultPdfAnnotationDelete, 'Archive/Research.pdf', added.id);
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Archive/Research.pdf')).toEqual([]);
  });

  it('rejects untrusted senders, unsafe document paths and mismatched identities', async () => {
    await expect(mock.handlers.get(IPC_CHANNELS.vaultPdfAnnotationAdd)!({}, input)).rejects.toThrow('Untrusted');
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, '../Research.pdf')).rejects.toThrow();
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Idea.md')).rejects.toThrow();
    await symlink(path.join(mock.root, input.path), path.join(mock.root, 'Linked.pdf'));
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Linked.pdf')).rejects.toThrow();
    await expect(
      invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, {
        ...input,
        target: { ...input.target, documentIdentity: { ...input.target.documentIdentity, vaultPath: 'Other.pdf' } },
      }),
    ).rejects.toThrow();
  });

  it('rejects protected content even in an unlocked vault and blocks all PDF operations while locked', async () => {
    await writeFile(
      path.join(mock.root, 'Protected.pdf'),
      JSON.stringify({ format: 'a11ynotebook-password-note-v1', ciphertext: 'secret' }),
    );
    await writeFile(
      path.join(mock.root, 'Protected.md'),
      JSON.stringify({ format: 'a11ynotebook-password-note-v1', ciphertext: 'secret' }),
    );
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Protected.pdf')).rejects.toThrow('unprotected');
    await expect(invoke(IPC_CHANNELS.vaultAnnotations, 'Protected.md')).rejects.toThrow('protected');
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'long-password-for-testing');
    const added = (await invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, input)) as PdfAnnotation;
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).rejects.toThrow('Unlock');
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, input)).rejects.toThrow('Unlock');
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotationUpdate, input.path, added.id, { comment: 'x' })).rejects.toThrow(
      'Unlock',
    );
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotationDelete, input.path, added.id)).rejects.toThrow('Unlock');
  });

  it('does not encrypt a note while leaving existing plaintext annotations behind', async () => {
    await invoke(IPC_CHANNELS.vaultAnnotationAdd, {
      path: 'Idea.md',
      anchor: { quote: 'words', start: 0, end: 5, prefix: '', suffix: '' },
      color: 'yellow',
      label: 'Highlight',
      comment: 'private text',
    });
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'long-password-for-testing');
    await expect(
      invoke(IPC_CHANNELS.vaultNoteEncrypt, 'Idea.md', 'words', 'long-note-password-for-testing'),
    ).rejects.toThrow('Delete plaintext annotations');
    expect(await readFile(path.join(mock.root, 'Idea.md'), 'utf8')).toBe('words');
  });
});
