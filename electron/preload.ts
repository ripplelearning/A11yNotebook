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
  onMenuCommand: (callback) => subscribe<MenuCommand>(CHANNELS.menuCommand, callback),
};

contextBridge.exposeInMainWorld('a11yNotebook', bridge);
