import { COMMANDS, type CommandId } from './command-registry';

export interface NotebookSettings {
  autosaveDelay: number;
  theme: 'dark' | 'light' | 'high-contrast';
  fontSize: number;
  shortcuts: Partial<Record<CommandId, string>>;
}

export const DEFAULT_SETTINGS: NotebookSettings = {
  autosaveDelay: 900,
  theme: 'dark',
  fontSize: 16,
  shortcuts: {},
};

const RESERVED_SHORTCUTS = [
  'F6',
  'Shift+F6',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+X',
  'Ctrl+V',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+Shift+Z',
  'Ctrl+0',
  'F11',
];

export function normalizeShortcut(shortcut: string): string {
  if (!shortcut.trim()) return '';
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop() ?? '';
  if (
    !/^(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/.test(key) ||
    parts.some((part) => !['ctrl', 'alt', 'shift'].includes(part)) ||
    new Set(parts).size !== parts.length ||
    (!/^f\d+$/.test(key) && !parts.includes('ctrl') && !parts.includes('alt'))
  ) {
    throw new Error('Use Ctrl/Alt plus a letter or number, or an F1–F12 key.');
  }
  return [
    ...(parts.includes('ctrl') ? ['Ctrl'] : []),
    ...(parts.includes('alt') ? ['Alt'] : []),
    ...(parts.includes('shift') ? ['Shift'] : []),
    key.toUpperCase(),
  ].join('+');
}

export function shortcutConflicts(shortcuts: NotebookSettings['shortcuts']): string[] {
  const used = new Map(RESERVED_SHORTCUTS.map((shortcut) => [shortcut.toLowerCase(), 'Pane/tab navigation']));
  const conflicts: string[] = [];
  for (const command of COMMANDS) {
    const shortcut = normalizeShortcut(shortcuts[command.id] ?? command.shortcut ?? '');
    if (!shortcut) continue;
    const previous = used.get(shortcut.toLowerCase());
    if (previous) conflicts.push(`${shortcut}: ${previous} and ${command.label}`);
    else used.set(shortcut.toLowerCase(), command.label);
  }
  return conflicts;
}

export function validateSettings(value: unknown): NotebookSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const settings = value as NotebookSettings;
  if (
    !Number.isInteger(settings.autosaveDelay) ||
    settings.autosaveDelay < 0 ||
    settings.autosaveDelay > 60000 ||
    !['dark', 'light', 'high-contrast'].includes(settings.theme) ||
    !Number.isInteger(settings.fontSize) ||
    settings.fontSize < 12 ||
    settings.fontSize > 32 ||
    !settings.shortcuts ||
    typeof settings.shortcuts !== 'object' ||
    Array.isArray(settings.shortcuts)
  )
    throw new Error('Invalid settings values.');
  const shortcuts: NotebookSettings['shortcuts'] = {};
  for (const [id, shortcut] of Object.entries(settings.shortcuts)) {
    if (!COMMANDS.some((command) => command.id === id) || typeof shortcut !== 'string') {
      throw new Error('Invalid command shortcut.');
    }
    shortcuts[id as CommandId] = normalizeShortcut(shortcut);
  }
  const conflicts = shortcutConflicts(shortcuts);
  if (conflicts.length) throw new Error(`Shortcut conflicts: ${conflicts.join('; ')}`);
  return { autosaveDelay: settings.autosaveDelay, theme: settings.theme, fontSize: settings.fontSize, shortcuts };
}
