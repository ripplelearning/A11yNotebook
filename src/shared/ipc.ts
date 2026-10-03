// The complete, fixed list of IPC channels used by A11y Notebook. The renderer never
// supplies channel names: the preload script maps a small typed API onto these
// constants, and the main process only registers handlers for this whitelist.
import { COMMANDS, type CommandId } from './command-registry';

export const IPC_CHANNELS = {
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterInstallNow: 'updater:install-now',
  updaterInstallOnExit: 'updater:install-on-exit',
  updaterStatus: 'updater:status',
  menuCommand: 'menu:command',
  vaultOpen: 'vault:open',
  vaultGet: 'vault:get',
  vaultReadNote: 'vault:read-note',
  vaultSaveNote: 'vault:save-note',
  vaultCreateNotebook: 'vault:create-notebook',
  vaultCreateNote: 'vault:create-note',
  vaultRename: 'vault:rename',
  vaultReveal: 'vault:reveal',
  vaultOpenExternal: 'vault:open-external',
  vaultImport: 'vault:import',
  vaultDelete: 'vault:delete',
  vaultGetTasks: 'vault:get-tasks',
  vaultToggleTask: 'vault:toggle-task',
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
  vaultCredentialsRead: 'vault:credentials-read',
  vaultCredentialsSave: 'vault:credentials-save',
  vaultCredentialsDelete: 'vault:credentials-delete',
  vaultCaptureWeb: 'vault:capture-web',
  vaultSecurityLocked: 'vault:security-locked',
} as const;

/** Channels the renderer may invoke (renderer → main, request/response). */
export const INVOKE_CHANNELS = [
  IPC_CHANNELS.updaterCheck,
  IPC_CHANNELS.updaterDownload,
  IPC_CHANNELS.updaterInstallNow,
  IPC_CHANNELS.updaterInstallOnExit,
  IPC_CHANNELS.vaultOpen,
  IPC_CHANNELS.vaultGet,
  IPC_CHANNELS.vaultReadNote,
  IPC_CHANNELS.vaultSaveNote,
  IPC_CHANNELS.vaultCreateNotebook,
  IPC_CHANNELS.vaultCreateNote,
  IPC_CHANNELS.vaultRename,
  IPC_CHANNELS.vaultReveal,
  IPC_CHANNELS.vaultOpenExternal,
  IPC_CHANNELS.vaultImport,
  IPC_CHANNELS.vaultDelete,
  IPC_CHANNELS.vaultGetTasks,
  IPC_CHANNELS.vaultToggleTask,
  IPC_CHANNELS.vaultGetLinkIndex,
  IPC_CHANNELS.vaultGetBookmarks,
  IPC_CHANNELS.vaultToggleBookmark,
  IPC_CHANNELS.vaultMove,
  IPC_CHANNELS.vaultSearch,
  IPC_CHANNELS.vaultTags,
  IPC_CHANNELS.vaultAnnotations,
  IPC_CHANNELS.vaultAnnotationAdd,
  IPC_CHANNELS.vaultAnnotationUpdate,
  IPC_CHANNELS.vaultAnnotationDelete,
  IPC_CHANNELS.vaultReadAttachment,
  IPC_CHANNELS.vaultImageAlt,
  IPC_CHANNELS.vaultSaveImageAlt,
  IPC_CHANNELS.settingsGet,
  IPC_CHANNELS.settingsSave,
  IPC_CHANNELS.vaultReminders,
  IPC_CHANNELS.vaultReminderCreate,
  IPC_CHANNELS.vaultReminderDismiss,
  IPC_CHANNELS.vaultReminderSnooze,
  IPC_CHANNELS.vaultAssetRead,
  IPC_CHANNELS.vaultAssetSave,
  IPC_CHANNELS.vaultAssetCreate,
  IPC_CHANNELS.vaultFlashcardsGet,
  IPC_CHANNELS.vaultFlashcardsSave,
  IPC_CHANNELS.vaultSecurityStatus,
  IPC_CHANNELS.vaultSecuritySetup,
  IPC_CHANNELS.vaultSecurityUnlock,
  IPC_CHANNELS.vaultSecurityLock,
  IPC_CHANNELS.vaultNoteEncrypt,
  IPC_CHANNELS.vaultCredentialsRead,
  IPC_CHANNELS.vaultCredentialsSave,
  IPC_CHANNELS.vaultCredentialsDelete,
  IPC_CHANNELS.vaultCaptureWeb,
] as const;

export const EVENT_CHANNELS = [IPC_CHANNELS.vaultSecurityLocked] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** Renderer-invokable updater calls, handled by the updater controller only. */
export const UPDATER_INVOKE_CHANNELS = [
  IPC_CHANNELS.updaterCheck,
  IPC_CHANNELS.updaterDownload,
  IPC_CHANNELS.updaterInstallNow,
  IPC_CHANNELS.updaterInstallOnExit,
] as const;
export type UpdaterInvokeChannel = (typeof UPDATER_INVOKE_CHANNELS)[number];

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value);
}

/** Commands the native application menu may forward to the renderer. */
export const MENU_COMMANDS = COMMANDS.map((command) => command.id);

export type MenuCommand = CommandId;

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value);
}
