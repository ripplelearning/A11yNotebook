import type { MenuCommand } from './ipc';
import type { UpdaterStatus } from './updater';
import type { VaultBookmark, VaultInfo, VaultLinkIndex, VaultTask } from './types';

/** Explicit local-vault operations exposed by the sandboxed preload bridge. */
export interface VaultBridge {
  open(): Promise<VaultInfo | null>;
  get(): Promise<VaultInfo | null>;
  readNote(path: string): Promise<string>;
  saveNote(path: string, content: string): Promise<void>;
  createNotebook(path: string): Promise<VaultInfo>;
  createNote(path: string): Promise<VaultInfo>;
  rename(path: string, name: string): Promise<VaultInfo>;
  reveal(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  importFile(notebookPath: string): Promise<VaultInfo | null>;
  delete(path: string): Promise<VaultInfo>;
  getTasks(): Promise<VaultTask[]>;
  toggleTask(path: string, line: number, complete: boolean): Promise<VaultTask[]>;
  getLinkIndex(): Promise<VaultLinkIndex>;
  getBookmarks(): Promise<VaultBookmark[]>;
  toggleBookmark(path: string): Promise<VaultBookmark[]>;
}

/** Narrow updater API exposed to the renderer through the preload script. */
export interface UpdaterBridge {
  /** Ask the main process to check the configured GitHub repository for a newer release. */
  check: () => Promise<void>;
  /** Download an update that was reported as available. Requires explicit user consent. */
  download: () => Promise<void>;
  /** Quit, install the downloaded update, and restart the application. */
  installNow: () => Promise<void>;
  /** Install the downloaded update when the application next exits. */
  installOnExit: () => Promise<void>;
  /** Subscribe to updater status changes. Returns an unsubscribe function. */
  onStatus: (callback: (status: UpdaterStatus) => void) => () => void;
}

/** Everything the preload script exposes on `window.a11yNotebook`. */
export interface NotebookBridge {
  updater: UpdaterBridge;
  vault: VaultBridge;
  /** Subscribe to commands chosen from the native application menu. Returns an unsubscribe function. */
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
}
