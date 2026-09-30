import type { NotebookBridge } from '../shared/bridge';

declare global {
  interface Window {
    /** Present only when running inside Electron with the preload script loaded. */
    a11yNotebook?: NotebookBridge;
  }

  /** Application version from package.json, injected at build time by Vite. */
  const __APP_VERSION__: string;
}

export {};
