// Preload runs in a sandbox, so it may only require('electron'). Everything imported
// from src/shared below is type-only and erased at compile time.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { NotebookBridge } from '../src/shared/bridge';
import type { IPC_CHANNELS as SharedChannels, MenuCommand } from '../src/shared/ipc';
import type { UpdaterStatus } from '../src/shared/updater';
import type { VaultChangedEvent } from '../src/shared/search';
import type { VaultReminderEvent } from '../src/shared/reminders';
import type { PdfReadingPreferences } from '../src/shared/pdf-reading-preferences';

// Must match src/shared/ipc.ts exactly; the type annotation enforces that at compile time.
const CHANNELS: typeof SharedChannels = {
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterInstallNow: 'updater:install-now',
  updaterInstallOnExit: 'updater:install-on-exit',
  updaterStatus: 'updater:status',
  menuCommand: 'menu:command',
  getPdfReadingPreferences: 'get-pdf-reading-preferences',
  setPdfReadingPreferences: 'set-pdf-reading-preferences',
  pdfReadingPreferencesChanged: 'pdf-reading-preferences-changed',
  vaultOpen: 'vault:open',
  vaultGet: 'vault:get',
  vaultReadNote: 'vault:read-note',
  vaultSaveNote: 'vault:save-note',
  vaultCreateNotebook: 'vault:create-notebook',
  vaultCreateNote: 'vault:create-note',
  vaultRename: 'vault:rename',
  vaultReveal: 'vault:reveal',
  vaultOpenExternal: 'vault:open-external',
  vaultOpenUrl: 'vault:open-url',
  vaultImport: 'vault:import',
  vaultDelete: 'vault:delete',
  vaultGetTasks: 'vault:get-tasks',
  vaultToggleTask: 'vault:toggle-task',
  vaultTaskDueDate: 'vault:task-due-date',
  vaultGetLinkIndex: 'vault:get-link-index',
  vaultGetBookmarks: 'vault:get-bookmarks',
  vaultToggleBookmark: 'vault:toggle-bookmark',
  vaultMove: 'vault:move',
  vaultSearch: 'vault:search',
  vaultTags: 'vault:tags',
  vaultChanged: 'vault:changed',
  vaultAnnotations: 'vault:annotations',
  vaultAnnotationAdd: 'vault:annotation-add',
  vaultAnnotationUpdate: 'vault:annotation-update',
  vaultAnnotationDelete: 'vault:annotation-delete',
  vaultReadAttachment: 'vault:read-attachment',
  vaultImageAlt: 'vault:image-alt',
  vaultSaveImageAlt: 'vault:save-image-alt',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  vaultReminders: 'vault:reminders',
  vaultReminderCreate: 'vault:reminder-create',
  vaultReminderDismiss: 'vault:reminder-dismiss',
  vaultReminderSnooze: 'vault:reminder-snooze',
  vaultReminderEvent: 'vault:reminder-event',
  vaultAssetRead: 'vault:asset-read',
  vaultAssetSave: 'vault:asset-save',
  vaultAssetCreate: 'vault:asset-create',
  vaultFlashcardsGet: 'vault:flashcards-get',
  vaultFlashcardsSave: 'vault:flashcards-save',
  vaultSecurityStatus: 'vault:security-status',
  vaultSecuritySetup: 'vault:security-setup',
  vaultSecurityUnlock: 'vault:security-unlock',
  vaultSecurityLock: 'vault:security-lock',
  vaultNoteEncrypt: 'vault:note-encrypt',
  vaultNoteEncryptionStatus: 'vault:note-encryption-status',
  vaultCredentialsRead: 'vault:credentials-read',
  vaultCredentialsSave: 'vault:credentials-save',
  vaultCredentialsDelete: 'vault:credentials-delete',
  vaultCaptureWeb: 'vault:capture-web',
  vaultExportNote: 'vault:export-note',
  vaultSecurityLocked: 'vault:security-locked',
};

function subscribe<T>(
  channel:
    | typeof CHANNELS.updaterStatus
    | typeof CHANNELS.menuCommand
    | typeof CHANNELS.pdfReadingPreferencesChanged
    | typeof CHANNELS.vaultChanged
    | typeof CHANNELS.vaultReminderEvent
    | typeof CHANNELS.vaultSecurityLocked,
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
  getPdfReadingPreferences: () => ipcRenderer.invoke(CHANNELS.getPdfReadingPreferences),
  setPdfReadingPreferences: (preferences) => ipcRenderer.invoke(CHANNELS.setPdfReadingPreferences, preferences),
  onPdfReadingPreferencesChanged: (callback) =>
    subscribe<PdfReadingPreferences>(CHANNELS.pdfReadingPreferencesChanged, callback),
  updater: {
    check: () => ipcRenderer.invoke(CHANNELS.updaterCheck),
    download: () => ipcRenderer.invoke(CHANNELS.updaterDownload),
    installNow: () => ipcRenderer.invoke(CHANNELS.updaterInstallNow),
    installOnExit: () => ipcRenderer.invoke(CHANNELS.updaterInstallOnExit),
    onStatus: (callback) => subscribe<UpdaterStatus>(CHANNELS.updaterStatus, callback),
  },
  vault: {
    open: () => ipcRenderer.invoke(CHANNELS.vaultOpen),
    get: () => ipcRenderer.invoke(CHANNELS.vaultGet),
    readNote: (relativePath, password) => ipcRenderer.invoke(CHANNELS.vaultReadNote, relativePath, password),
    saveNote: (relativePath, content, expectedContent) =>
      ipcRenderer.invoke(CHANNELS.vaultSaveNote, relativePath, content, expectedContent),
    createNotebook: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultCreateNotebook, relativePath),
    createNote: (relativePath, content) => ipcRenderer.invoke(CHANNELS.vaultCreateNote, relativePath, content),
    rename: (relativePath, name) => ipcRenderer.invoke(CHANNELS.vaultRename, relativePath, name),
    move: (relativePath, destination) => ipcRenderer.invoke(CHANNELS.vaultMove, relativePath, destination),
    search: (query) => ipcRenderer.invoke(CHANNELS.vaultSearch, query),
    getTags: () => ipcRenderer.invoke(CHANNELS.vaultTags),
    onChanged: (callback) => subscribe<VaultChangedEvent>(CHANNELS.vaultChanged, callback),
    getAnnotations: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultAnnotations, relativePath),
    addAnnotation: (annotation) => ipcRenderer.invoke(CHANNELS.vaultAnnotationAdd, annotation),
    updateAnnotation: (relativePath, id, update) =>
      ipcRenderer.invoke(CHANNELS.vaultAnnotationUpdate, relativePath, id, update),
    deleteAnnotation: (relativePath, id) => ipcRenderer.invoke(CHANNELS.vaultAnnotationDelete, relativePath, id),
    readAttachment: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultReadAttachment, relativePath),
    getImageAlt: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultImageAlt, relativePath),
    saveImageAlt: (relativePath, alt) => ipcRenderer.invoke(CHANNELS.vaultSaveImageAlt, relativePath, alt),
    getSettings: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.settingsSave, settings),
    getReminders: () => ipcRenderer.invoke(CHANNELS.vaultReminders),
    createReminder: (input) => ipcRenderer.invoke(CHANNELS.vaultReminderCreate, input),
    dismissReminder: (id) => ipcRenderer.invoke(CHANNELS.vaultReminderDismiss, id),
    snoozeReminder: (id, duration) => ipcRenderer.invoke(CHANNELS.vaultReminderSnooze, id, duration),
    onReminder: (callback) => subscribe<VaultReminderEvent>(CHANNELS.vaultReminderEvent, callback),
    readAsset: (relative) => ipcRenderer.invoke(CHANNELS.vaultAssetRead, relative),
    saveAsset: (relative, content, expected) =>
      ipcRenderer.invoke(CHANNELS.vaultAssetSave, relative, content, expected),
    createAsset: (relative, content) => ipcRenderer.invoke(CHANNELS.vaultAssetCreate, relative, content),
    getFlashcardSchedules: (relative) => ipcRenderer.invoke(CHANNELS.vaultFlashcardsGet, relative),
    saveFlashcardSchedule: (relative, id, schedule, expected) =>
      ipcRenderer.invoke(CHANNELS.vaultFlashcardsSave, relative, id, schedule, expected),
    getSecurityStatus: () => ipcRenderer.invoke(CHANNELS.vaultSecurityStatus),
    setupVaultPassword: (password) => ipcRenderer.invoke(CHANNELS.vaultSecuritySetup, password),
    unlockVault: (password) => ipcRenderer.invoke(CHANNELS.vaultSecurityUnlock, password),
    lockVault: () => ipcRenderer.invoke(CHANNELS.vaultSecurityLock),
    encryptNote: (relative, expected, password) =>
      ipcRenderer.invoke(CHANNELS.vaultNoteEncrypt, relative, expected, password),
    isNoteEncrypted: (relative) => ipcRenderer.invoke(CHANNELS.vaultNoteEncryptionStatus, relative),
    readCredentials: () => ipcRenderer.invoke(CHANNELS.vaultCredentialsRead),
    saveCredential: (id, username, password) =>
      ipcRenderer.invoke(CHANNELS.vaultCredentialsSave, id, username, password),
    deleteCredential: (id) => ipcRenderer.invoke(CHANNELS.vaultCredentialsDelete, id),
    captureWeb: (url, notebookPath, format) => ipcRenderer.invoke(CHANNELS.vaultCaptureWeb, url, notebookPath, format),
    exportNote: (relativePath, format, content, protectedConsent) =>
      ipcRenderer.invoke(CHANNELS.vaultExportNote, relativePath, format, content, protectedConsent),
    onSecurityLocked: (callback) => subscribe<boolean>(CHANNELS.vaultSecurityLocked, () => callback()),
    reveal: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultReveal, relativePath),
    openExternal: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultOpenExternal, relativePath),
    openUrl: (url) => ipcRenderer.invoke(CHANNELS.vaultOpenUrl, url),
    importFile: (notebookPath) => ipcRenderer.invoke(CHANNELS.vaultImport, notebookPath),
    delete: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultDelete, relativePath),
    getTasks: () => ipcRenderer.invoke(CHANNELS.vaultGetTasks),
    toggleTask: (relativePath, location, complete, revision) =>
      ipcRenderer.invoke(CHANNELS.vaultToggleTask, relativePath, location, complete, revision),
    setHtmlTaskDueDate: (relativePath, taskId, dueDate, revision) =>
      ipcRenderer.invoke(CHANNELS.vaultTaskDueDate, relativePath, taskId, dueDate, revision),
    getLinkIndex: () => ipcRenderer.invoke(CHANNELS.vaultGetLinkIndex),
    getBookmarks: () => ipcRenderer.invoke(CHANNELS.vaultGetBookmarks),
    toggleBookmark: (relativePath) => ipcRenderer.invoke(CHANNELS.vaultToggleBookmark, relativePath),
  },
  onMenuCommand: (callback) => subscribe<MenuCommand>(CHANNELS.menuCommand, callback),
};

contextBridge.exposeInMainWorld('a11yNotebook', bridge);
