import type { MenuCommand } from './ipc';
import type { UpdaterStatus } from './updater';

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
  /** Subscribe to commands chosen from the native application menu. Returns an unsubscribe function. */
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
}
