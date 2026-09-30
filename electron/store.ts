// Local JSON persistence. This lives in the main process because it needs Node's
// filesystem and Electron's app paths; the renderer must never import it.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { sampleNotebook, sampleVault } from '../src/shared/sample-data';
import type { Notebook, Vault } from '../src/shared/types';

const storeFileName = 'a11y-notebook-store.json';

export type NotebookStore = {
  vaults: Vault[];
  notebooks: Notebook[];
};

export const fallbackStore: NotebookStore = {
  vaults: [sampleVault],
  notebooks: [sampleNotebook],
};

export function getStorePath() {
  return path.join(app.getPath('userData'), storeFileName);
}

function isNotebookStore(value: unknown): value is NotebookStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<NotebookStore>;
  return Array.isArray(candidate.vaults) && Array.isArray(candidate.notebooks);
}

export function loadStore(): NotebookStore {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getStorePath(), 'utf-8'));
    return isNotebookStore(parsed) ? parsed : fallbackStore;
  } catch {
    return fallbackStore;
  }
}

export function saveStore(data: NotebookStore) {
  const storePath = getStorePath();
  const temporaryPath = `${storePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(temporaryPath, storePath);
}
