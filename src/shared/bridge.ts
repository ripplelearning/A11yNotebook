import type { MenuCommand, NativeMenuState } from './ipc';
import type { UpdaterStatus } from './updater';
import type {
  ItemStats,
  PointerImport,
  PointerImportFailure,
  ReadingPosition,
  ReadingPositionInput,
  RecentLibrary,
  VaultBookmark,
  VaultCaptureResult,
  VaultInfo,
  VaultLinkIndex,
  VaultTask,
} from './types';
import type { VaultChangedEvent, VaultSearchQuery, VaultSearchResult } from './search';
import type { AnnotationUpdate, NewAnnotation, NoteAnnotation } from './annotations';
import type { NewPdfAnnotation, PdfAnnotation, PdfAnnotationUpdate } from './pdf-annotation';
import type { PdfFormSkippedField, PdfFormValues, PdfFormValuesRecord } from './pdf-form';
import type { TemplateLinkRecord } from './template-fields';
import type { OcrLanguageStatus } from './ocr';
import type { DocxAnnotation, DocxAnnotationUpdate, NewDocxAnnotation } from './docx-annotations';
import type { EpubAnnotation, EpubAnnotationUpdate, NewEpubAnnotation } from './epub-annotations';
import type { AttachmentPreview } from './attachments';
import type { ImportChoice, ImportPending } from './alius';
import type { PasteContentInput } from './paste-content';
import type { NotebookSettings } from './settings';
import type { CreateReminderInput, Reminder, SnoozeDuration, VaultReminderEvent } from './reminders';
import type { ReminderDefaults } from './reminder-defaults';
import type { VaultAsset } from './asset-bridge';
import type { AssetDraft, AssetDraftInput, AssetDraftRecovery } from './asset-drafts';
import type { CardSchedule } from './assets';
import type { PdfReadingPreferences } from './pdf-reading-preferences';
import type { DocxStructure } from './docx';
import type { SpreadsheetWorkbook } from './spreadsheet';
import type { SlideDeck } from './slides';

/** Explicit local-vault operations exposed by the sandboxed preload bridge. */
export interface VaultBridge {
  open(): Promise<VaultInfo | null>;
  createLibrary?(): Promise<VaultInfo | null>;
  backupLibrary?(): Promise<{ cancelled: boolean; path?: string; files?: number; bytes?: number }>;
  createAutoBackup?(folder: string, keepCount: number): Promise<{ path: string; files: number; bytes: number }>;
  /** Resolve an OS-copied File to its filesystem path. Unverified on real Windows clipboard paste. */
  getPathForFile?(file: File): string;
  pasteInspect?(source: string): Promise<{
    kind: 'folder' | 'file';
    name: string;
    folders: string[];
    files: string[];
  }>;
  pasteChooseFolder?(title: string): Promise<string | null>;
  pasteLibraryCopy?(source: string, parent: string): Promise<{ path: string; files: number; bytes: number }>;
  pasteLibraryAdd?(source: string): Promise<RecentLibrary>;
  pasteNotebook?(source: string): Promise<{ notebook: string; files: number }>;
  pasteFiles?(sources: string[], notebookPath: string): Promise<{ files: string[] }>;
  /**
   * Validate a pasted file like an import and return the pending copy-or-Alius choice.
   * Nothing is written yet; the user chooses first, then `pasteFileComplete` finishes it.
   */
  pasteFileStart?(source: string, notebookPath: string): Promise<ImportPending>;
  /** Finish a pasted file with the user's copy-or-Alius choice and file name. */
  pasteFileComplete?(
    pending: ImportPending,
    choice: ImportChoice,
    fileName: string,
  ): Promise<{ vault: VaultInfo; path: string }>;
  /** Store pasted clipboard content (text, HTML, or an image) as a note or a file attachment. */
  pasteContent?(input: PasteContentInput): Promise<{ vault: VaultInfo; path: string }>;
  pasteOrganize?(libraryPath: string, orphanFiles: string[], mode: 'one' | 'per-file', notebookName?: string): Promise<string[]>;
  getRecentLibraries?(): Promise<RecentLibrary[]>;
  openLibraryPath?(path: string): Promise<VaultInfo | null>;
  forgetLastOpened?(): Promise<void>;
  get(): Promise<VaultInfo | null>;
  readNote(path: string, password?: string): Promise<string>;
  saveNote(path: string, content: string, expectedContent?: string): Promise<void>;
  /** Save a recorded audio Blob into a notebook folder; returns the saved path and updated vault view. */
  saveAudioRecording?(
    notebookPath: string,
    fileName: string,
    data: ArrayBuffer,
  ): Promise<{ path: string; vault: VaultInfo }>;
  /** Read an audio file's bytes for in-app transcription; 40 MB limit, same as saving a recording. */
  readAudioData?(path: string): Promise<{ path: string; data: Uint8Array }>;
  createNotebook(path: string): Promise<VaultInfo>;
  createNote(path: string, content?: string): Promise<VaultInfo>;
  /** Create a standalone link (.url file) in a notebook; returns its path and the updated view. */
  createLink?(input: { title: string; url: string; notebookPath?: string }): Promise<{
    path: string;
    vault: VaultInfo;
  }>;
  /** Change a link's title and/or URL; returns the link's final path and the updated view. */
  saveLink?(input: { path: string; title: string; url: string }): Promise<{ path: string; vault: VaultInfo }>;
  rename(path: string, name: string): Promise<VaultInfo>;
  move(path: string, destination: string): Promise<VaultInfo>;
  /** Protection flag for an item; absent on older bridges. */
  setProtection?(path: string, value: boolean): Promise<VaultInfo>;
  /** File details for the properties dialog; absent on older bridges. */
  getItemStats?(path: string): Promise<ItemStats>;
  /** Duplicate an item, recursively for notebooks; absent on older bridges. */
  copyEntry?(path: string, destination: string): Promise<VaultInfo>;
  /** Open a new email with the file attached; absent on older bridges. */
  emailItem?(path: string): Promise<void>;
  search(query: VaultSearchQuery): Promise<VaultSearchResult[]>;
  getTags(): Promise<string[]>;
  /** Library front-matter field names with their values; absent on older bridges. */
  getFrontMatterIndex?(): Promise<Record<string, string[]>>;
  onChanged(callback: (event: VaultChangedEvent) => void): () => void;
  getAnnotations(path: string): Promise<NoteAnnotation[]>;
  addAnnotation(annotation: NewAnnotation): Promise<NoteAnnotation>;
  updateAnnotation(path: string, id: string, update: AnnotationUpdate): Promise<NoteAnnotation>;
  deleteAnnotation(path: string, id: string): Promise<void>;
  listPdfAnnotations(path: string): Promise<PdfAnnotation[]>;
  addPdfAnnotation(annotation: NewPdfAnnotation): Promise<PdfAnnotation>;
  updatePdfAnnotation(path: string, id: string, update: PdfAnnotationUpdate): Promise<PdfAnnotation>;
  deletePdfAnnotation(path: string, id: string): Promise<void>;
  /** Filled values for a fillable PDF, stored in the app like PDF notes. */
  getPdfFormValues(path: string): Promise<PdfFormValues>;
  savePdfFormValues(
    path: string,
    values: PdfFormValues,
    identity: PdfFormValuesRecord['documentIdentity'],
  ): Promise<PdfFormValuesRecord>;
  /** Source template of a filled note, stored in the app like filled PDF values. Null when unlinked. */
  getTemplateLink?(path: string): Promise<string | null>;
  saveTemplateLink?(path: string, templatePath: string | null): Promise<TemplateLinkRecord | null>;
  /** Write the stored values into a filled file chosen with a save dialog. */
  downloadFilledPdf(path: string): Promise<{
    saved: boolean;
    fileName?: string;
    skippedFields?: PdfFormSkippedField[];
  }>;
  /** Write the stored values into a filled copy inside the same notebook. */
  saveFilledPdfCopy(path: string): Promise<{ path: string; name: string; skippedFields?: PdfFormSkippedField[] }>;
  /**
   * Save OCR results into a file: a managed file is updated in place,
   * while an Alius saves a copy in the library and never touches the
   * original. `bytes` are the whole file with the recognized text written
   * in; the result names the file that now holds the text and whether it
   * is a new copy. Absent on older bridges.
   */
  saveOcrText?(
    path: string,
    kind: '.pdf' | '.epub',
    bytes: Uint8Array,
  ): Promise<{ path: string; name: string; copied: boolean }>;
  /** OCR languages with whether each one's data is already on this computer; absent on older bridges. */
  listOcrLanguages?(): Promise<OcrLanguageStatus[]>;
  /**
   * Download a language's OCR data once when it is not already on this
   * computer; returns whether the data is ready and whether this call
   * downloaded it. Absent on older bridges.
   */
  ensureOcrLanguage?(code: string): Promise<{ ready: boolean; downloaded: boolean }>;
  listDocxAnnotations(path: string): Promise<DocxAnnotation[]>;
  addDocxAnnotation(annotation: NewDocxAnnotation): Promise<DocxAnnotation>;
  updateDocxAnnotation(path: string, id: string, update: DocxAnnotationUpdate): Promise<DocxAnnotation>;
  deleteDocxAnnotation(path: string, id: string): Promise<void>;
  listEpubAnnotations(path: string): Promise<EpubAnnotation[]>;
  addEpubAnnotation(annotation: NewEpubAnnotation): Promise<EpubAnnotation>;
  updateEpubAnnotation(path: string, id: string, update: EpubAnnotationUpdate): Promise<EpubAnnotation>;
  deleteEpubAnnotation(path: string, id: string): Promise<void>;
  readAttachment(path: string): Promise<AttachmentPreview>;
  readDocxStructure(path: string): Promise<DocxStructure>;
  readSpreadsheet(path: string): Promise<SpreadsheetWorkbook>;
  readSlideDeck(path: string): Promise<SlideDeck>;
  saveSpreadsheet(path: string, workbook: SpreadsheetWorkbook): Promise<void>;
  saveSpreadsheetAsXlsx(path: string, workbook: SpreadsheetWorkbook): Promise<string>;
  getImageAlt(path: string): Promise<string>;
  saveImageAlt(path: string, alt: string): Promise<void>;
  getSettings(): Promise<NotebookSettings>;
  saveSettings(settings: NotebookSettings): Promise<void>;
  getReminders(): Promise<Reminder[]>;
  createReminder(input: CreateReminderInput): Promise<Reminder[]>;
  dismissReminder(id: string): Promise<Reminder[]>;
  completeReminder?(id: string, revision?: string): Promise<Reminder[]>;
  snoozeReminder(id: string, duration: SnoozeDuration): Promise<Reminder[]>;
  getReminderDefaults?(): Promise<ReminderDefaults>;
  setReminderDefaults?(defaults: ReminderDefaults): Promise<ReminderDefaults>;
  onReminder(callback: (event: VaultReminderEvent) => void): () => void;
  reminderAlertsReady?(): Promise<VaultReminderEvent[]>;
  reminderWakeFocus?(): Promise<{ libraryPath: string; reminderId: string } | null>;
  readAsset(path: string): Promise<VaultAsset>;
  readAssetDraft?(path: string): Promise<AssetDraftRecovery>;
  checkpointAssetDraft?(input: AssetDraftInput, token: string): Promise<AssetDraft>;
  discardAssetDraft?(path: string, revision: string, token: string): Promise<void>;
  saveAsset(path: string, content: string, expectedContent: string): Promise<void>;
  createAsset(path: string, content: string): Promise<VaultInfo>;
  getFlashcardSchedules(path: string): Promise<Record<string, CardSchedule>>;
  saveFlashcardSchedule(path: string, id: string, schedule: CardSchedule, expectedContent: string): Promise<void>;
  getSecurityStatus?(): Promise<{ enabled: boolean; locked: boolean; recoveryAvailable: boolean }>;
  getMetadataProtectionStatus?(): Promise<import('./metadata-protection').MetadataProtectionStatus>;
  enableMetadataProtection?(
    input: import('./metadata-protection').EnableMetadataProtectionInput,
  ): Promise<import('./metadata-protection').MetadataProtectionStatus>;
  extendMetadataProtection?(
    input: import('./metadata-protection').ExtendMetadataProtectionInput,
  ): Promise<import('./metadata-protection').MetadataProtectionStatus>;
  setupVaultPassword?(password: string): Promise<void>;
  unlockVault?(password: string): Promise<VaultInfo>;
  lockVault?(): Promise<void>;
  prepareVaultRecovery?(password: string): Promise<string>;
  acknowledgeVaultRecovery?(acknowledged: boolean): Promise<void>;
  recoverVault?(recoveryKey: string, newPassword: string): Promise<VaultInfo>;
  revokeVaultRecovery?(password: string): Promise<void>;
  rotateVaultDataKey?(password: string, recoveryKey: string | null): Promise<void>;
  libraryEncryptionStatus?(): Promise<{ enabled: boolean; state: 'migrating' | 'active' | 'decrypting' | null; files: number }>;
  enableLibraryEncryption?(acknowledge: boolean): Promise<void>;
  disableLibraryEncryption?(acknowledge: boolean): Promise<void>;
  encryptNote?(path: string, expectedContent: string, password: string): Promise<void>;
  isNoteEncrypted?(path: string): Promise<boolean>;
  readCredentials?(): Promise<{ id: string; username: string; password: string }[]>;
  saveCredential?(id: string, username: string, password: string): Promise<void>;
  deleteCredential?(id: string): Promise<void>;
  captureWeb?(url: string, notebookPath: string, format: 'markdown' | 'html' | 'webpage'): Promise<VaultCaptureResult>;
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
  openWith?(
    path: string,
    options?: { makeDefault?: boolean },
  ): Promise<{ cancelled: boolean; settingsOpened?: boolean }>;
  openUrl(url: string): Promise<void>;
  /** Pick a file for import: validates it and returns the pending choice, or a link-pointer outcome. Nothing is written yet. */
  importFile(
    notebookPath: string,
  ): Promise<ImportPending | { pointer: PointerImport } | { pointerFailed: PointerImportFailure } | null>;
  /** Finish a pending import with the user's copy-or-Alius choice; returns the created item and the updated view. */
  importComplete?(pending: ImportPending, choice: ImportChoice): Promise<{ vault: VaultInfo; path: string }>;
  /** Pick a replacement original for a broken Alius record; returns the retargeted item and the updated view. */
  locateAlius?(path: string): Promise<{ vault: VaultInfo; path: string } | null>;
  importAsNote?(path: string): Promise<{ vault: VaultInfo; path: string }>;
  /** Pick an in-library file for import: validates it and returns the pending choice. Nothing is written yet. */
  importEntry?(path: string): Promise<ImportPending | null>;
  adoptEncrypted?(path: string, password?: string): Promise<VaultInfo | null>;
  delete(path: string): Promise<VaultInfo>;
  deletePermanently(path: string, hasUnsavedChanges: boolean): Promise<VaultInfo>;
  deleteLibrary?(path: string, permanent?: boolean): Promise<{ deleted: boolean }>;
  chooseReminderSoundFile?(): Promise<string | null>;
  readReminderSoundFile?(path: string): Promise<string>;
  getTasks(): Promise<VaultTask[]>;
  createTask?(input: {
    notebookPath?: string;
    text: string;
    due?: string;
    reminder?: string;
    priority?: string;
  }): Promise<VaultTask[]>;
  toggleTask(path: string, location: string | number, complete: boolean, revision?: string): Promise<VaultTask[]>;
  setHtmlTaskDueDate(path: string, taskId: string, dueDate: string, revision: string): Promise<VaultTask[]>;
  setHtmlTaskSchedule?(
    path: string,
    taskId: string,
    schedule: { dueDate: string; dueTime: string; remindAt: string },
    revision: string,
  ): Promise<VaultTask[]>;
  setHtmlTaskPriority?(path: string, taskId: string, priority: string, revision: string): Promise<VaultTask[]>;
  getLinkIndex(): Promise<VaultLinkIndex>;
  getBookmarks(): Promise<VaultBookmark[]>;
  toggleBookmark(path: string): Promise<VaultBookmark[]>;
  addBookmark(
    path: string,
    anchor?: import('./types').BookmarkAnchor,
    name?: string,
    context?: string,
  ): Promise<VaultBookmark[]>;
  removeBookmark(id: string): Promise<VaultBookmark[]>;
  lookupThesaurus(word: string): Promise<import('./thesaurus').ThesaurusGroup[]>;
  fetchDictionaryDefinitions?(word: string): Promise<import('./thesaurus').DictionaryMeaning[]>;
  getBibliography(notebookPath: string): Promise<import('./citations').BibliographyEntry[]>;
  getTaskLinks?(): Promise<import('./task-links').TaskLink[]>;
  saveTaskLinks?(links: import('./task-links').TaskLink[]): Promise<import('./task-links').TaskLink[]>;
  getDismissedTaskAutoLinks?(): Promise<string[]>;
  saveDismissedTaskAutoLinks?(ids: string[]): Promise<string[]>;
  saveBibliography(
    notebookPath: string,
    entries: import('./citations').BibliographyEntry[],
  ): Promise<import('./citations').BibliographyEntry[]>;
  fetchCitationMetadata(
    identifier: string,
  ): Promise<Partial<import('./citations').BibliographyEntry>>;
  getCalendar?(): Promise<import('./calendar').CalendarAppointment[]>;
  saveCalendar?(
    appointments: import('./calendar').CalendarAppointment[],
    options?: { source?: 'local' | 'sync' },
  ): Promise<import('./calendar').CalendarAppointment[]>;
  getSyncState?(): Promise<import('./calendar-sync').SyncStateFile>;
  saveSyncState?(
    state: import('./calendar-sync').SyncStateFile,
  ): Promise<import('./calendar-sync').SyncStateFile>;
  configureGoogle?(client: { clientId: string; clientSecret: string }): Promise<{ configured: boolean }>;
  signInGoogle?(): Promise<{ signedIn: boolean }>;
  googleStatus?(): Promise<{ configured: boolean; signedIn: boolean }>;
  getGoogleAccessToken?(): Promise<string>;
  signOutGoogle?(): Promise<{ signedIn: boolean }>;
  configureOutlook?(client: { clientId: string }): Promise<{ configured: boolean }>;
  signInOutlook?(): Promise<{ signedIn: boolean }>;
  outlookStatus?(): Promise<{ configured: boolean; signedIn: boolean }>;
  getOutlookAccessToken?(): Promise<string>;
  signOutOutlook?(): Promise<{ signedIn: boolean }>;
  configureApple?(signIn: { appleId: string; appPassword: string }): Promise<{ configured: boolean }>;
  appleStatus?(): Promise<{ configured: boolean; signedIn: boolean }>;
  getAppleCredentials?(): Promise<{ appleId: string; appPassword: string }>;
  verifyApple?(): Promise<{ calendarName: string }>;
  listAppleCalendars?(): Promise<Array<{ name: string; url: string }>>;
  signOutApple?(): Promise<{ signedIn: boolean }>;
  getReadingPosition?(path: string): Promise<ReadingPosition | null>;
  setReadingPosition?(path: string, position: ReadingPositionInput): Promise<void>;
}

/** Narrow updater API exposed to the renderer through the preload script. */
export interface UpdaterBridge {
  /** Ask the main process to check the configured GitHub repository for a newer release. */
  check: () => Promise<void>;
  /** Download an update that was reported as available. Requires explicit user consent. */
  download: () => Promise<void>;
  /** Quit, install the downloaded update, and restart the application. */
  installNow: () => Promise<void>;
  /** Subscribe to updater status changes. Returns an unsubscribe function. */
  onStatus: (callback: (status: UpdaterStatus) => void) => () => void;
}

/** Everything the preload script exposes on `window.a11yNotebook`. */
export interface NotebookBridge {
  /** Suspend native menu shortcuts while a shortcut field captures keyboard input. */
  setShortcutCaptureActive?(active: boolean): void;
  setZoomFactor?(factor: number): void;
  updater: UpdaterBridge;
  vault: VaultBridge;
  getPdfReadingPreferences?(): Promise<PdfReadingPreferences>;
  setPdfReadingPreferences?(preferences: PdfReadingPreferences): Promise<PdfReadingPreferences>;
  onPdfReadingPreferencesChanged?(callback: (preferences: PdfReadingPreferences) => void): () => void;
  /** Subscribe to commands chosen from the native application menu. Returns an unsubscribe function. */
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
  setMenuState?: (state: NativeMenuState) => void;
  /** Host platform (process.platform) for platform-specific key and label handling. */
  platform?: string;
}
