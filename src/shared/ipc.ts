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
} as const;

/** Channels the renderer may invoke (renderer → main, request/response). */
export const INVOKE_CHANNELS = [
  IPC_CHANNELS.updaterCheck,
  IPC_CHANNELS.updaterDownload,
  IPC_CHANNELS.updaterInstallNow,
  IPC_CHANNELS.updaterInstallOnExit,
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value);
}

/** Commands the native application menu may forward to the renderer. */
export const MENU_COMMANDS = ['check-for-updates', 'show-keyboard-shortcuts', 'show-about'] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value);
}
