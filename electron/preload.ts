import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('a11yNotebook', {
  getVersion: () => process.env.npm_package_version || '0.1.0',
});

export type NotebookBridge = {
  getVersion: () => string;
};

declare global {
  interface Window {
    a11yNotebook: NotebookBridge;
  }
}
