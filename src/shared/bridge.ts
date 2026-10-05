import type { MenuCommand } from './ipc';
import type { UpdaterStatus } from './updater';
import type { VaultBookmark, VaultCaptureResult, VaultInfo, VaultLinkIndex, VaultTask } from './types';
import type { VaultChangedEvent, VaultSearchQuery, VaultSearchResult } from './search';
import type { AnnotationUpdate, NewAnnotation, NoteAnnotation } from './annotations';
import type { NewPdfAnnotation, PdfAnnotation, PdfAnnotationUpdate } from './pdf-annotation';
import type { AttachmentPreview } from './attachments';
import type { NotebookSettings } from './settings';
import type { CreateReminderInput, Reminder, SnoozeDuration, VaultReminderEvent } from './reminders';
import type { VaultAsset } from './asset-bridge';
import type { CardSchedule } from './assets';
import type { PdfReadingPreferences } from './pdf-reading-preferences';

/** Explicit local-vault operations exposed by the sandboxed preload bridge. */
export interface VaultBridge {
  open(): Promise<VaultInfo | null>;
  get(): Promise<VaultInfo | null>;
  readNote(path: string, password?: string): Promise<string>;
  saveNote(path: string, content: string, expectedContent?: string): Promise<void>;
  createNotebook(path: string): Promise<VaultInfo>;
  createNote(path: string, content?: string): Promise<VaultInfo>;
  rename(path: string, name: string): Promise<VaultInfo>;
  move(path: string, destination: string): Promise<VaultInfo>;
  search(query: VaultSearchQuery): Promise<VaultSearchResult[]>;
  getTags(): Promise<string[]>;
  onChanged(callback: (event: VaultChangedEvent) => void): () => void;
  getAnnotations(path: string): Promise<NoteAnnotation[]>;
  addAnnotation(annotation: NewAnnotation): Promise<NoteAnnotation>;
  updateAnnotation(path: string, id: string, update: AnnotationUpdate): Promise<NoteAnnotation>;
  deleteAnnotation(path: string, id: string): Promise<void>;
  listPdfAnnotations(path: string): Promise<PdfAnnotation[]>;
  addPdfAnnotation(annotation: NewPdfAnnotation): Promise<PdfAnnotation>;
  updatePdfAnnotation(path: string, id: string, update: PdfAnnotationUpdate): Promise<PdfAnnotation>;
  deletePdfAnnotation(path: string, id: string): Promise<void>;
  readAttachment(path: string): Promise<AttachmentPreview>;
  getImageAlt(path: string): Promise<string>;
  saveImageAlt(path: string, alt: string): Promise<void>;
  getSettings(): Promise<NotebookSettings>;
  saveSettings(settings: NotebookSettings): Promise<void>;
  getReminders(): Promise<Reminder[]>;
  createReminder(input: CreateReminderInput): Promise<Reminder[]>;
  dismissReminder(id: string): Promise<Reminder[]>;
  snoozeReminder(id: string, duration: SnoozeDuration): Promise<Reminder[]>;
  onReminder(callback: (event: VaultReminderEvent) => void): () => void;
  readAsset(path: string): Promise<VaultAsset>;
  saveAsset(path: string, content: string, expectedContent: string): Promise<void>;
  createAsset(path: string, content: string): Promise<VaultInfo>;
  getFlashcardSchedules(path: string): Promise<Record<string, CardSchedule>>;
  saveFlashcardSchedule(path: string, id: string, schedule: CardSchedule, expectedContent: string): Promise<void>;
  getSecurityStatus?(): Promise<{ enabled: boolean; locked: boolean }>;
  setupVaultPassword?(password: string): Promise<void>;
  unlockVault?(password: string): Promise<VaultInfo>;
  lockVault?(): Promise<void>;
  encryptNote?(path: string, expectedContent: string, password: string): Promise<void>;
  isNoteEncrypted?(path: string): Promise<boolean>;
  readCredentials?(): Promise<{ id: string; username: string; password: string }[]>;
  saveCredential?(id: string, username: string, password: string): Promise<void>;
  deleteCredential?(id: string): Promise<void>;
  captureWeb?(url: string, notebookPath: string, format: 'markdown' | 'html'): Promise<VaultCaptureResult>;
  exportNote?(
    path: string,
    format: 'html' | 'markdown',
    content: string,
    protectedContentConsent: boolean,
  ): Promise<{
    cancelled: boolean;
    omittedImages: number;
  }>;
  onSecurityLocked?(callback: () => void): () => void;
  reveal(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  importFile(notebookPath: string): Promise<VaultInfo | null>;
  delete(path: string): Promise<VaultInfo>;
  getTasks(): Promise<VaultTask[]>;
  toggleTask(path: string, location: string | number, complete: boolean, revision?: string): Promise<VaultTask[]>;
  setHtmlTaskDueDate(path: string, taskId: string, dueDate: string, revision: string): Promise<VaultTask[]>;
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
  getPdfReadingPreferences?(): Promise<PdfReadingPreferences>;
  setPdfReadingPreferences?(preferences: PdfReadingPreferences): Promise<PdfReadingPreferences>;
  onPdfReadingPreferencesChanged?(callback: (preferences: PdfReadingPreferences) => void): () => void;
  /** Subscribe to commands chosen from the native application menu. Returns an unsubscribe function. */
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
}
