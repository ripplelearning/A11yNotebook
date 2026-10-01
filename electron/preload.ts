// Preload runs in a sandbox, so it may only require('electron'). Everything imported
// from src/shared below is type-only and erased at compile time.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { NotebookBridge } from '../src/shared/bridge';
import type { IPC_CHANNELS as SharedChannels, MenuCommand } from '../src/shared/ipc';
import type { UpdaterStatus } from '../src/shared/updater';

// Must match src/shared/ipc.ts exactly; the type annotation enforces that at compile time.
const CHANNELS: typeof SharedChannels = {
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterInstallNow: 'updater:install-now',
  updaterInstallOnExit: 'updater:install-on-exit',
  updaterStatus: 'updater:status',
  menuCommand: 'menu:command',
  vaultOpen: 'vault:open',
  vaultGet: 'vault:get',
  vaultReadNote: 'vault:read-note',
  vaultSaveNote: 'vault:save-note',
  vaultCreateNotebook: 'vault:create-notebook',
  vaultCreateNote: 'vault:create-note',
  vaultRename: 'vault:rename',
  vaultReveal: 'vault:reveal',
  vaultOpenExternal: 'vault:open-external',
  vaultImport: 'vault:import',
  vaultDelete: 'vault:delete',
  vaultGetTasks: 'vault:get-tasks',
  vaultToggleTask: 'vault:toggle-task',
  vaultGetLinkIndex: 'vault:get-link-index',
  vaultGetBookmarks: 'vault:get-bookmarks',
  vaultToggleBookmark: 'vault:toggle-bookmark',
};

function subscribe<T>(
  channel: typeof CHANNELS.updaterStatus | typeof CHANNELS.menuCommand,
  callback: (value: T) => void,
) {
  // Never hand the raw IpcRendererEvent (which exposes the sender) to the page.
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: NotebookBridge = {
  updater: {
    check: () => ipcRenderer.invoke(CHANNELS.updaterCheck),
    download: () => ipcRenderer.invoke(CHANNELS.updaterDownload),
    installNow: () => ipcRenderer.invoke(CHANNELS.updaterInstallNow),
    installOnExit: () => ipcRenderer.invoke(CHANNELS.updaterInstallOnExit),
    onStatus: (callback) => subscribe<UpdaterStatus>(CHANNELS.updaterStatus, callback),
  },
  vault: {
    open: () => ipcRenderer.invoke(CHANNELS.vaultOpen),
    get: () => ipcRenderer.invoke(CHANNELS.vaultGet),
    readNote: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultReadNote, relativePath),
    saveNote: (relativePath, content) => ipcRenderer.invoke(CHANNELS.vaultSaveNote, relativePath, content),
    createNotebook: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultCreateNotebook, relativePath),
    createNote: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultCreateNote, relativePath),
    rename: (relativePath, name) => ipcRenderer.invoke(CHANNELS.vaultRename, relativePath, name),
    reveal: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultReveal, relativePath),
    openExternal: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultOpenExternal, relativePath),
    importFile: (notebookPath) => ipcRenderer.invoke(CHANNELS.vaultImport, notebookPath),
    delete: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultDelete, relativePath),
    getTasks: () => ipcRenderer.invoke(CHANNELS.vaultGetTasks),
    toggleTask: (relativePath, line, complete) =>
      ipcRenderer.invoke(CHANNELS.vaultToggleTask, relativePath, line, complete),
    getLinkIndex: () => ipcRenderer.invoke(CHANNELS.vaultGetLinkIndex),
    getBookmarks: () => ipcRenderer.invoke(CHANNELS.vaultGetBookmarks),
    toggleBookmark: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultToggleBookmark, relativePath),
  },
  onMenuCommand: (callback) => subscribe<MenuCommand>(CHANNELS.menuCommand, callback),
};

contextBridge.exposeInMainWorld('a11yNotebook', bridge);
