// Local JSON persistence. This lives in the main process because it needs Node's
// filesystem and Electron's app paths; the renderer must never import it.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { sampleNotebook, sampleVault } from '../src/shared/sample-data';
import type { Notebook, Vault } from '../src/shared/types';
import {
  DEFAULT_PDF_READING_PREFERENCES,
  validatePdfReadingPreferences,
  type PdfReadingPreferences,
} from '../src/shared/pdf-reading-preferences';

const storeFileName = 'a11y-notebook-store.json';

export type NotebookStore = {
  vaults: Vault[];
  notebooks: Notebook[];
  pdfReadingPreferences: PdfReadingPreferences;
};

export const fallbackStore: NotebookStore = {
  vaults: [sampleVault],
  notebooks: [sampleNotebook],
  pdfReadingPreferences: { ...DEFAULT_PDF_READING_PREFERENCES },
};

export function getStorePath() {
  return path.join(app.getPath('userData'), storeFileName);
}

function isNotebookStore(value: unknown): value is Pick<NotebookStore, 'vaults' | 'notebooks'> & {
  pdfReadingPreferences?: unknown;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<NotebookStore>;
  return Array.isArray(candidate.vaults) && Array.isArray(candidate.notebooks);
}

export function loadStore(): NotebookStore {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getStorePath(), 'utf-8'));
    if (!isNotebookStore(parsed)) return structuredClone(fallbackStore);
    let pdfReadingPreferences = { ...DEFAULT_PDF_READING_PREFERENCES };
    if (Object.hasOwn(parsed, 'pdfReadingPreferences')) {
      try {
        pdfReadingPreferences = validatePdfReadingPreferences(parsed.pdfReadingPreferences);
      } catch (error) {
        console.warn('Invalid persisted PDF reading preferences; using defaults.', error);
      }
    }
    return { ...parsed, pdfReadingPreferences };
  } catch {
    return structuredClone(fallbackStore);
  }
}

export function saveStore(
  data: Pick<NotebookStore, 'vaults' | 'notebooks'> & Partial<Pick<NotebookStore, 'pdfReadingPreferences'>>,
) {
  const pdfReadingPreferences = Object.hasOwn(data, 'pdfReadingPreferences')
    ? validatePdfReadingPreferences(data.pdfReadingPreferences)
    : loadStore().pdfReadingPreferences;
  const storePath = getStorePath();
  const temporaryPath = `${storePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify({ ...data, pdfReadingPreferences }, null, 2), 'utf-8');
  renameSync(temporaryPath, storePath);
}

export function getPdfReadingPreferences(): PdfReadingPreferences {
  return loadStore().pdfReadingPreferences;
}

export function setPdfReadingPreferences(value: unknown): PdfReadingPreferences {
  const pdfReadingPreferences = validatePdfReadingPreferences(value);
  saveStore({ ...loadStore(), pdfReadingPreferences });
  return pdfReadingPreferences;
}
