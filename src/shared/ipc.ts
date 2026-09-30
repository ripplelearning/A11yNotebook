// The complete, fixed list of IPC channels used by A11y Notebook. The renderer never
// supplies channel names: the preload script maps a small typed API onto these
// constants, and the main process only registers handlers for this whitelist.

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
] as const;

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
export const MENU_COMMANDS = ['check-for-updates', 'show-keyboard-shortcuts', 'show-about'] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value);
}
