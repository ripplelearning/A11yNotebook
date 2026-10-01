// Owns the narrow, validated IPC boundary for local vault filesystem operations.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import { createVaultService } from './service';

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;
type VaultService = ReturnType<typeof createVaultService>;

const recentFile = () => path.join(app.getPath('userData'), 'recent-vault.json');
let service: VaultService | null = null;

function assertTrusted(event: IpcMainInvokeEvent, isTrustedSender: TrustedSender) {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
}

function requireService() {
  if (!service) throw new Error('Open a vault first.');
  return service;
}

async function rememberVault(vaultPath: string) {
  await mkdir(path.dirname(recentFile()), { recursive: true });
  await writeFile(recentFile(), JSON.stringify({ lastOpened: vaultPath }), 'utf8');
}

async function openVault(vaultPath: string) {
  const nextService = createVaultService(vaultPath);
  const vault = await nextService.initialize();
  service = nextService;
  await rememberVault(vault.path);
  return vault;
}

/** Register fixed handlers; every operation checks the top-level trusted renderer. */
export function setupVaultIpc(isTrustedSender: TrustedSender) {
  ipcMain.handle(IPC_CHANNELS.vaultOpen, async (event) => {
    assertTrusted(event, isTrustedSender);
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : openVault(result.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.vaultGet, async (event) => {
    assertTrusted(event, isTrustedSender);
    if (service) return service.getVault();
    try {
      const saved = JSON.parse(await readFile(recentFile(), 'utf8')) as { lastOpened?: unknown };
      if (typeof saved.lastOpened !== 'string') return null;
      return await openVault(saved.lastOpened);
    } catch {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.vaultReadNote, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Note path must be text.');
    return requireService().readNote(relativePath);
  });
  ipcMain.handle(IPC_CHANNELS.vaultSaveNote, async (event, relativePath: unknown, content: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string' || typeof content !== 'string') throw new Error('Invalid note data.');
    await requireService().saveNote(relativePath, content);
  });
  ipcMain.handle(IPC_CHANNELS.vaultCreateNotebook, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Notebook path must be text.');
    return requireService().createFolder(relativePath);
  });
  ipcMain.handle(IPC_CHANNELS.vaultCreateNote, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Note path must be text.');
    return requireService().createNote(relativePath);
  });
  ipcMain.handle(IPC_CHANNELS.vaultRename, async (event, relativePath: unknown, name: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string' || typeof name !== 'string') throw new Error('Invalid rename request.');
    return requireService().renameEntry(relativePath, name);
  });
  ipcMain.handle(IPC_CHANNELS.vaultReveal, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Path must be text.');
    shell.showItemInFolder(await requireService().resolveEntry(relativePath));
  });
  ipcMain.handle(IPC_CHANNELS.vaultOpenExternal, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Path must be text.');
    const error = await shell.openPath(await requireService().resolveEntry(relativePath));
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC_CHANNELS.vaultImport, async (event, notebookPath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof notebookPath !== 'string') throw new Error('Notebook path must be text.');
    const vault = requireService();
    await vault.resolveEntry(notebookPath);
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const destination = await vault.resolveEntry(path.posix.join(notebookPath, path.basename(source)), true);
    await copyFile(source, destination, 1);
    return vault.getVault();
  });
  ipcMain.handle(IPC_CHANNELS.vaultDelete, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Path must be text.');
    const vault = requireService();
    const target = await vault.resolveEntry(relativePath);
    if (target === vaultPathOf(await vault.getVault())) throw new Error('The vault itself cannot be deleted here.');
    const answer = await dialog.showMessageBox({
      type: 'warning',
      title: 'Delete item',
      message: `Move “${path.basename(target)}” to the Recycle Bin?`,
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return vault.getVault();
    await shell.trashItem(target);
    return vault.getVault();
  });
  ipcMain.handle(IPC_CHANNELS.vaultGetTasks, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getTasks();
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultToggleTask,
    async (event, relativePath: unknown, line: unknown, complete: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relativePath !== 'string' || typeof line !== 'number' || typeof complete !== 'boolean') {
        throw new Error('Invalid task update request.');
      }
      return requireService().toggleTask(relativePath, line, complete);
    },
  );
  ipcMain.handle(IPC_CHANNELS.vaultGetLinkIndex, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getLinkIndex();
  });
  ipcMain.handle(IPC_CHANNELS.vaultGetBookmarks, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getBookmarks();
  });
  ipcMain.handle(IPC_CHANNELS.vaultToggleBookmark, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Bookmark path must be text.');
    return requireService().toggleBookmark(relativePath);
  });
}

function vaultPathOf(vault: { path: string }) {
  return vault.path;
}
