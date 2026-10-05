import { useSyncExternalStore } from 'react';
import {
  DEFAULT_PDF_READING_PREFERENCES,
  validatePdfReadingPreferences,
  type PdfReadingPreferences,
} from '../../shared/pdf-reading-preferences';
import type { NotebookBridge } from '../../shared/bridge';

let bridge: NotebookBridge | undefined;
let preferences = DEFAULT_PDF_READING_PREFERENCES;
let revision = 0;
let pendingRead: Promise<PdfReadingPreferences> | undefined;
let disconnect: (() => void) | undefined;
const listeners = new Set<() => void>();

function publish(value: PdfReadingPreferences) {
  if (
    preferences.hideHeadersFooters === value.hideHeadersFooters &&
    preferences.hidePageNumbers === value.hidePageNumbers
  )
    return;
  preferences = value;
  listeners.forEach((listener) => listener());
}

function currentBridge() {
  if (bridge !== window.a11yNotebook) {
    bridge = window.a11yNotebook;
    revision += 1;
    pendingRead = undefined;
    preferences = DEFAULT_PDF_READING_PREFERENCES;
  }
  return bridge;
}

export function refreshPdfReadingPreferences(): Promise<PdfReadingPreferences> {
  const api = currentBridge();
  if (!api?.getPdfReadingPreferences) return Promise.resolve(preferences);
  if (pendingRead) return pendingRead;
  const readRevision = revision;
  const request = api.getPdfReadingPreferences().then((value) => {
    if (readRevision === revision) publish(validatePdfReadingPreferences(value));
    return preferences;
  });
  pendingRead = request;
  void request
    .finally(() => {
      if (pendingRead === request) pendingRead = undefined;
    })
    .catch(() => undefined);
  return request;
}

export async function savePdfReadingPreferences(value: PdfReadingPreferences): Promise<void> {
  const api = currentBridge();
  if (!api?.setPdfReadingPreferences) throw new Error('PDF reading settings are unavailable.');
  revision += 1;
  pendingRead = undefined;
  const saved = await api.setPdfReadingPreferences(validatePdfReadingPreferences(value));
  publish(validatePdfReadingPreferences(saved));
}

function subscribe(listener: () => void) {
  const api = currentBridge();
  listeners.add(listener);
  if (listeners.size === 1) {
    const refresh = () => {
      void refreshPdfReadingPreferences().catch(() => console.warn('Could not load PDF reading preferences.'));
    };
    const unsubscribe = api?.onPdfReadingPreferencesChanged?.((value) => {
      try {
        revision += 1;
        pendingRead = undefined;
        publish(validatePdfReadingPreferences(value));
      } catch {
        console.warn('Invalid PDF reading preferences received.');
      }
    });
    window.addEventListener('focus', refresh);
    refresh();
    disconnect = () => {
      window.removeEventListener('focus', refresh);
      unsubscribe?.();
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      disconnect?.();
      disconnect = undefined;
    }
  };
}

export function usePdfReadingPreferences(): PdfReadingPreferences {
  return useSyncExternalStore(subscribe, () => {
    currentBridge();
    return preferences;
  });
}
