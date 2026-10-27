import { COMMANDS, effectiveShortcutAliases, type CommandId } from './command-registry';

export interface NotebookSettings {
  autosaveDelay: number;
  theme: 'dark' | 'light' | 'high-contrast';
  fontSize: number;
  showCommandButtons?: boolean;
  shortcuts: Partial<Record<CommandId, string>>;
  /** Alternate-shortcut overrides by command: a value replaces the registry alias, '' disables it. */
  shortcutAliases?: Partial<Record<CommandId, string>>;
  vaultLockMinutes?: number;
  noteEditLockMinutes?: number;
  defaultNoteOpenMode?: 'read-only' | 'edit';
  reminderAlerts?: boolean;
  /** User-managed task priority options, highest first. Single words only, so they survive in task lines. */
  priorityOptions?: string[];
  reminderSound?: boolean;
  reminderSoundChoice?: 'gentle-chime';
  reminderVolume?: number;
  backgroundReminders?: boolean;
  /** Name reminder titles in alerts after the app closes; off by default, and titles then stay out of the snapshot. */
  backgroundReminderTitles?: boolean;
  /** Words the user added from the spelling dialog; never flagged again. */
  customDictionary?: string[];
  /** Whole-interface scale in percent (100 = normal). Distinct from font size. */
  zoomPercent?: number;
  /** Thicker, more offset focus outlines for low vision. */
  focusRing?: 'standard' | 'high-visibility';
  /** Turn off interface animations and transitions. */
  reducedMotion?: boolean;
  /** Automatic whole-library backups, off unless the user turns them on. */
  autoBackupEnabled?: boolean;
  /** Days between automatic backups. */
  autoBackupIntervalDays?: number;
  /** How many automatic backups to keep; older ones are deleted. */
  autoBackupKeepCount?: number;
  /** Folder that holds automatic backups; blank means a Backups folder next to the library. */
  autoBackupFolder?: string;
  /** ISO timestamp of the last completed automatic backup, or ''. */
  lastAutoBackupAt?: string;
  /** Keep the calendar offline: hide provider sync setup and never run a sync. */
  calendarOffline?: boolean;
}

export const DEFAULT_SETTINGS: NotebookSettings = {
  autosaveDelay: 900,
  theme: 'dark',
  fontSize: 16,
  showCommandButtons: false,
  shortcuts: {},
  shortcutAliases: {},
  vaultLockMinutes: 15,
  noteEditLockMinutes: 0,
  defaultNoteOpenMode: 'read-only',
  reminderAlerts: false,
  reminderSound: false,
  reminderSoundChoice: 'gentle-chime',
  reminderVolume: 50,
  backgroundReminders: false,
  backgroundReminderTitles: false,
  customDictionary: [],
  zoomPercent: 100,
  focusRing: 'standard',
  reducedMotion: false,
  autoBackupEnabled: false,
  autoBackupIntervalDays: 7,
  autoBackupKeepCount: 5,
  autoBackupFolder: '',
  lastAutoBackupAt: '',
  calendarOffline: false,
};

/**
 * Normalize a stored custom dictionary: lowercase single words, deduped,
 * capped so a pasted list cannot bloat settings.
 */
export function normalizeCustomDictionary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const word = entry.trim().toLowerCase();
    if (!/^[a-z]+(?:'[a-z]+)?$/.test(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length >= 5000) break;
  }
  return words;
}

/**
 * Canonical priority values are lowercase single words; display capitalizes
 * them. Lowercasing here keeps stored values stable across the old
 * low/normal/high/urgent set, the new Critical/High/Medium/Low/Optional
 * set, and user-added options, so filters, sorting, and existing task
 * lines keep working.
 */
export const DEFAULT_PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low', 'optional'];

/**
 * Normalize a stored priority list: keep single-word names (letters, digits,
 * hyphens, underscores), lowercased, drop blanks and duplicates, and fall
 * back to the defaults when nothing valid remains.
 */
export function normalizePriorityOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [...DEFAULT_PRIORITY_OPTIONS];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const option of options) {
    if (typeof option !== 'string') continue;
    const value = option.trim().toLowerCase();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.length ? normalized : [...DEFAULT_PRIORITY_OPTIONS];
}

export function resolvePriorityOptions(settings: NotebookSettings): string[] {
  return normalizePriorityOptions(settings.priorityOptions);
}

/** Display a stored priority name with its first letter capitalized. */
export function formatPriorityName(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

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
  // F11 is deliberately NOT reserved: it is the Toggle Focus Mode registry
  // shortcut. The conflict checker still keeps it exclusive, because a
  // second command claiming F11 collides with the registry primary.
];

const NAMED_SHORTCUT_KEYS: Record<string, string> = {
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

export function normalizeShortcut(shortcut: string): string {
  if (!shortcut.trim()) return '';
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop() ?? '';
  const namedKey = NAMED_SHORTCUT_KEYS[key];
  if (
    (!namedKey && !/^(?:[a-z0-9=]|f(?:[1-9]|1[0-2]))$/.test(key)) ||
    parts.some((part) => !['ctrl', 'alt', 'shift'].includes(part)) ||
    new Set(parts).size !== parts.length ||
    (!/^f\d+$/.test(key) && !parts.includes('ctrl') && !parts.includes('alt'))
  ) {
    throw new Error('Use Ctrl/Alt plus a letter, number, =, or navigation key, or an F1–F12 key.');
  }
  return [
    ...(parts.includes('ctrl') ? ['Ctrl'] : []),
    ...(parts.includes('alt') ? ['Alt'] : []),
    ...(parts.includes('shift') ? ['Shift'] : []),
    namedKey ?? key.toUpperCase(),
  ].join('+');
}

/**
 * Detect identical shortcut assignments, compared by command id (not label,
 * so two commands that ever share a label cannot mask a real collision).
 * Reserved pane/tab keys, primary shortcuts, and alternate shortcuts all
 * count. The context-aware new-in-current-view command is a single command
 * with one binding, so it is never a duplicate of the creation commands it
 * covers; it is checked like any other command.
 */
export function shortcutConflicts(
  shortcuts: NotebookSettings['shortcuts'],
  aliasShortcuts: NotebookSettings['shortcutAliases'] = {},
): string[] {
  const used = new Map<string, { id: string; label: string }>(
    RESERVED_SHORTCUTS.map((shortcut) => [shortcut.toLowerCase(), { id: 'reserved', label: 'Pane/tab navigation' }]),
  );
  const conflicts: string[] = [];
  const claim = (shortcut: string, command: { id: string; label: string }) => {
    const previous = used.get(shortcut.toLowerCase());
    if (previous && previous.id !== command.id) {
      conflicts.push(`${shortcut}: ${previous.label} (${previous.id}) and ${command.label} (${command.id})`);
    } else if (!previous) {
      used.set(shortcut.toLowerCase(), command);
    }
  };
  for (const command of COMMANDS) {
    for (const alias of effectiveShortcutAliases(command, aliasShortcuts)) {
      claim(normalizeShortcut(alias), command);
    }
  }
  for (const command of COMMANDS) {
    const shortcut = normalizeShortcut(shortcuts[command.id] ?? command.shortcut ?? '');
    if (!shortcut) continue;
    claim(shortcut, command);
  }
  return conflicts;
}

export function validateSettings(value: unknown): NotebookSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const settings = value as NotebookSettings;
  const vaultLockMinutes = settings.vaultLockMinutes ?? DEFAULT_SETTINGS.vaultLockMinutes!;
  const noteEditLockMinutes = settings.noteEditLockMinutes ?? DEFAULT_SETTINGS.noteEditLockMinutes!;
  const defaultNoteOpenMode =
    settings.defaultNoteOpenMode === undefined ||
    (value as { defaultNoteOpenMode?: unknown }).defaultNoteOpenMode === 'read'
      ? 'read-only'
      : settings.defaultNoteOpenMode;
  const reminderAlerts = settings.reminderAlerts === undefined ? false : settings.reminderAlerts;
  const reminderSound = settings.reminderSound === undefined ? false : settings.reminderSound;
  const reminderSoundChoice =
    settings.reminderSoundChoice === undefined ? 'gentle-chime' : settings.reminderSoundChoice;
  const reminderVolume = settings.reminderVolume === undefined ? 50 : settings.reminderVolume;
  const backgroundReminders = settings.backgroundReminders === undefined ? false : settings.backgroundReminders;
  const backgroundReminderTitles =
    settings.backgroundReminderTitles === undefined ? false : settings.backgroundReminderTitles;
  const showCommandButtons = settings.showCommandButtons === undefined ? false : settings.showCommandButtons;
  const zoomPercent = settings.zoomPercent === undefined ? 100 : settings.zoomPercent;
  const focusRing = settings.focusRing === undefined ? 'standard' : settings.focusRing;
  const reducedMotion = settings.reducedMotion === undefined ? false : settings.reducedMotion;
  const autoBackupEnabled = settings.autoBackupEnabled === undefined ? false : settings.autoBackupEnabled;
  const autoBackupIntervalDays =
    settings.autoBackupIntervalDays === undefined ? 7 : settings.autoBackupIntervalDays;
  const autoBackupKeepCount = settings.autoBackupKeepCount === undefined ? 5 : settings.autoBackupKeepCount;
  const autoBackupFolder = settings.autoBackupFolder === undefined ? '' : settings.autoBackupFolder;
  const lastAutoBackupAt = settings.lastAutoBackupAt === undefined ? '' : settings.lastAutoBackupAt;
  const calendarOffline = settings.calendarOffline === undefined ? false : settings.calendarOffline;
  if (
    !Number.isInteger(settings.autosaveDelay) ||
    settings.autosaveDelay < 0 ||
    settings.autosaveDelay > 60000 ||
    !['dark', 'light', 'high-contrast'].includes(settings.theme) ||
    !Number.isInteger(settings.fontSize) ||
    settings.fontSize < 12 ||
    settings.fontSize > 32 ||
    typeof showCommandButtons !== 'boolean' ||
    !Number.isInteger(vaultLockMinutes) ||
    vaultLockMinutes < 0 ||
    vaultLockMinutes > 240 ||
    !Number.isInteger(noteEditLockMinutes) ||
    noteEditLockMinutes < 0 ||
    noteEditLockMinutes > 240 ||
    (defaultNoteOpenMode !== 'read-only' && defaultNoteOpenMode !== 'edit') ||
    typeof reminderAlerts !== 'boolean' ||
    typeof backgroundReminders !== 'boolean' ||
    typeof backgroundReminderTitles !== 'boolean' ||
    typeof reminderSound !== 'boolean' ||
    reminderSoundChoice !== 'gentle-chime' ||
    !Number.isInteger(reminderVolume) ||
    reminderVolume < 0 ||
    reminderVolume > 100 ||
    !Number.isInteger(zoomPercent) ||
    zoomPercent < 50 ||
    zoomPercent > 200 ||
    (focusRing !== 'standard' && focusRing !== 'high-visibility') ||
    typeof reducedMotion !== 'boolean' ||
    typeof autoBackupEnabled !== 'boolean' ||
    !Number.isInteger(autoBackupIntervalDays) ||
    autoBackupIntervalDays < 1 ||
    autoBackupIntervalDays > 30 ||
    !Number.isInteger(autoBackupKeepCount) ||
    autoBackupKeepCount < 1 ||
    autoBackupKeepCount > 50 ||
    typeof autoBackupFolder !== 'string' ||
    typeof lastAutoBackupAt !== 'string' ||
    typeof calendarOffline !== 'boolean' ||
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
  const aliasShortcuts: NotebookSettings['shortcutAliases'] = {};
  if (settings.shortcutAliases && typeof settings.shortcutAliases === 'object' && !Array.isArray(settings.shortcutAliases)) {
    for (const [id, shortcut] of Object.entries(settings.shortcutAliases)) {
      if (!COMMANDS.some((command) => command.id === id) || typeof shortcut !== 'string') {
        throw new Error('Invalid command shortcut.');
      }
      aliasShortcuts[id as CommandId] = normalizeShortcut(shortcut);
    }
  }
  const conflicts = shortcutConflicts(shortcuts, aliasShortcuts);
  if (conflicts.length) throw new Error(`Shortcut conflicts: ${conflicts.join('; ')}`);
  return {
    autosaveDelay: settings.autosaveDelay,
    theme: settings.theme,
    fontSize: settings.fontSize,
    showCommandButtons,
    shortcuts,
    shortcutAliases: aliasShortcuts,
    vaultLockMinutes,
    noteEditLockMinutes,
    defaultNoteOpenMode,
    reminderAlerts,
    reminderSound,
    reminderSoundChoice,
    reminderVolume,
    backgroundReminders,
    backgroundReminderTitles,
    customDictionary: normalizeCustomDictionary(settings.customDictionary),
    zoomPercent,
    focusRing,
    reducedMotion,
    autoBackupEnabled,
    autoBackupIntervalDays,
    autoBackupKeepCount,
    autoBackupFolder,
    lastAutoBackupAt,
    calendarOffline,
  };
}
