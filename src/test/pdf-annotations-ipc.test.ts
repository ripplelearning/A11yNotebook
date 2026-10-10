// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  folder = await mkdtemp(path.join(tmpdir(), 'a11y-pdf-annotation-ipc-test-'));
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
  it('opts in only with explicit consent and keeps annotations encrypted across move and recovery', async () => {
    const added = await invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, input);
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'old vault password');
    await expect(invoke(IPC_CHANNELS.vaultMetadataProtectionEnable, { acknowledgeExclusions: true })).rejects.toThrow();
    const recovery = await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'old vault password');
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
    await expect(
      invoke(IPC_CHANNELS.vaultMetadataProtectionEnable, { acknowledgeExclusions: false }),
    ).rejects.toThrow();
    expect(await invoke(IPC_CHANNELS.vaultMetadataProtectionEnable, { acknowledgeExclusions: true })).toMatchObject({
      enabled: true,
      cleanupRequired: false,
    });
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([added]);
    await invoke(IPC_CHANNELS.vaultMove, input.path, 'Archive/Research.pdf');
    const directory = path.join(mock.root, '.a11ynotebook');
    expect(await readdir(directory)).not.toContain('annotations.json');
    for (const name of (await readdir(directory)).filter((name) => /^(?:protected-|pending-)/.test(name))) {
      const text = await readFile(path.join(directory, name), 'utf8');
      expect(text).not.toContain('Study');
      expect(text).not.toContain('Archive/Research.pdf');
    }
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Archive/Research.pdf')).rejects.toThrow('Unlock');
    await invoke(IPC_CHANNELS.vaultSecurityRecover, recovery, 'new vault password');
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Archive/Research.pdf')).toHaveLength(1);
    await invoke(IPC_CHANNELS.vaultSecurityRevokeRecovery, 'new vault password');
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'new vault password');
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Archive/Research.pdf')).toHaveLength(1);
    expect(await readdir(directory)).not.toContain('annotations.json');
  });

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

  it('preserves PDF annotations and credentials across recovery reset and revocation', async () => {
    const password = 'long-password-for-testing';
    const newPassword = 'new-password-for-testing';
    const credential = { id: 'research', username: 'reader', password: 'test-credential' };
    const added = (await invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, input)) as PdfAnnotation;
    await invoke(IPC_CHANNELS.vaultSecuritySetup, password);
    await invoke(IPC_CHANNELS.vaultCredentialsSave, credential.id, credential.username, credential.password);
    const recoveryKey = await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, password);
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([added]);

    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await invoke(IPC_CHANNELS.vaultOpen);
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).rejects.toThrow('Unlock');
    await invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, newPassword);
    expect(await invoke(IPC_CHANNELS.vaultCredentialsRead)).toEqual([credential]);
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([added]);
    const updated = await invoke(IPC_CHANNELS.vaultPdfAnnotationUpdate, input.path, added.id, {
      comment: 'After recovery',
    });
    expect(updated).toMatchObject({ id: added.id, comment: 'After recovery' });
    const second = await invoke(IPC_CHANNELS.vaultPdfAnnotationAdd, { ...input, label: 'After recovery' });
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([updated, second]);

    await invoke(IPC_CHANNELS.vaultSecurityRevokeRecovery, newPassword);
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, 'another-test-password')).rejects.toThrow(
      /not configured/,
    );
    await expect(invoke(IPC_CHANNELS.vaultSecurityUnlock, password)).rejects.toThrow(/Incorrect vault password/);
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, newPassword);
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([updated, second]);
    expect(await invoke(IPC_CHANNELS.vaultCredentialsRead)).toEqual([credential]);
    await invoke(IPC_CHANNELS.vaultPdfAnnotationDelete, input.path, added.id);
    expect(await invoke(IPC_CHANNELS.vaultPdfAnnotations, input.path)).toEqual([second]);
  });

  it('rejects protected content even in an unlocked vault and blocks all PDF operations while locked', async () => {
    await writeFile(
      path.join(mock.root, 'Protected.pdf'),
      JSON.stringify({ format: 'a11ynotebook-password-note-v1', ciphertext: 'secret' }),
    );
    await expect(invoke(IPC_CHANNELS.vaultPdfAnnotations, 'Protected.pdf')).rejects.toThrow('unprotected');
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
});
