import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeShortcut, settingsLoadStatusMessage, shortcutConflicts, validateSettings } from '../shared/settings';

describe('settings and shortcut validation', () => {
  it('defaults missing command-button preferences to menu-first and persists either mode', () => {
    expect(DEFAULT_SETTINGS.showCommandButtons).toBe(false);
    expect(
      validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} }).showCommandButtons,
    ).toBe(false);
    for (const showCommandButtons of [true, false]) {
      expect(validateSettings(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, showCommandButtons })))).toMatchObject({
        showCommandButtons,
      });
    }
  });
  it.each([null, 0, 1, 'true', {}, []])('rejects non-boolean command-button preference %j', (showCommandButtons) => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, showCommandButtons })).toThrow('Invalid settings values.');
  });
  it('defaults appearance and automatic backup preferences', () => {
    const validated = validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} });
    expect(validated).toMatchObject({
      zoomPercent: 100,
      focusRing: 'standard',
      reducedMotion: false,
      autoBackupEnabled: false,
      autoBackupIntervalDays: 7,
      autoBackupKeepCount: 5,
      autoBackupFolder: '',
      lastAutoBackupAt: '',
    });
    expect(
      validateSettings({
        ...DEFAULT_SETTINGS,
        zoomPercent: 150,
        focusRing: 'high-visibility',
        reducedMotion: true,
        autoBackupEnabled: true,
        autoBackupIntervalDays: 1,
        autoBackupKeepCount: 3,
        autoBackupFolder: 'D:/Backups',
        lastAutoBackupAt: '2026-10-25T00:00:00.000Z',
      }),
    ).toMatchObject({
      zoomPercent: 150,
      focusRing: 'high-visibility',
      reducedMotion: true,
      autoBackupEnabled: true,
      autoBackupIntervalDays: 1,
      autoBackupKeepCount: 3,
      autoBackupFolder: 'D:/Backups',
      lastAutoBackupAt: '2026-10-25T00:00:00.000Z',
    });
  });
  it.each([
    { zoomPercent: 49 },
    { zoomPercent: 201 },
    { focusRing: 'huge' },
    { reducedMotion: 'yes' },
    { autoBackupIntervalDays: 0 },
    { autoBackupIntervalDays: 31 },
    { autoBackupKeepCount: 0 },
    { autoBackupKeepCount: 51 },
    { autoBackupFolder: 42 },
  ])('rejects invalid appearance or backup preference %j', (overrides) => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, ...overrides })).toThrow('Invalid settings values.');
  });
  it('defaults the calendar to online and persists the offline choice', () => {
    expect(DEFAULT_SETTINGS.calendarOffline).toBe(false);
    expect(
      validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} })
        .calendarOffline,
    ).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, calendarOffline: true }).calendarOffline).toBe(true);
  });
  it.each([null, 0, 1, 'true', {}, []])('rejects non-boolean calendar offline preference %j', (calendarOffline) => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, calendarOffline })).toThrow(
      'Invalid settings values.',
    );
  });
  it('defaults legacy note-open preferences to read-only', () => {
    expect(DEFAULT_SETTINGS.defaultNoteOpenMode).toBe('read-only');
    expect(
      validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} }).defaultNoteOpenMode,
    ).toBe('read-only');
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultNoteOpenMode: undefined }).defaultNoteOpenMode).toBe(
      'read-only',
    );
  });
  it.each(['read-only', 'edit'] as const)('preserves the %s note-open preference through serialization', (mode) => {
    const saved = validateSettings({ ...DEFAULT_SETTINGS, defaultNoteOpenMode: mode });
    expect(validateSettings(JSON.parse(JSON.stringify(saved))).defaultNoteOpenMode).toBe(mode);
  });
  it.each(['Edit', '', null, false, 0, {}, []])('rejects invalid note-open preference %j', (mode) => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, defaultNoteOpenMode: mode })).toThrow(
      'Invalid settings values.',
    );
  });
  it('defaults legacy note opening to Read mode and persists only supported opening modes', () => {
    expect(validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} })).toHaveProperty(
      'defaultNoteOpenMode',
      'read-only',
    );
    for (const defaultNoteOpenMode of ['read-only', 'edit']) {
      expect(validateSettings({ ...DEFAULT_SETTINGS, defaultNoteOpenMode })).toHaveProperty(
        'defaultNoteOpenMode',
        defaultNoteOpenMode,
      );
    }
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultNoteOpenMode: 'read' }).defaultNoteOpenMode).toBe(
      'read-only',
    );
    for (const defaultNoteOpenMode of [null, '', 'preview', true, 1]) {
      expect(() => validateSettings({ ...DEFAULT_SETTINGS, defaultNoteOpenMode })).toThrow();
    }
  });
  it('persists reminder preferences, migrates legacy settings and rejects invalid sound values', () => {
    const choices = {
      reminderAlerts: false,
      reminderSound: true,
      reminderSoundChoice: 'gentle-chime',
      reminderVolume: 75,
    };
    expect(validateSettings({ ...DEFAULT_SETTINGS, ...choices })).toMatchObject(choices);
    expect(validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} })).toMatchObject({
      reminderAlerts: false,
      reminderSound: false,
      reminderSoundChoice: 'gentle-chime',
      reminderVolume: 50,
    });
    for (const value of [
      { reminderAlerts: 'yes' },
      { reminderSound: 1 },
      { reminderSoundChoice: '../file' },
      { reminderVolume: -1 },
      { reminderVolume: 101 },
      { reminderVolume: 1.5 },
    ]) {
      expect(() => validateSettings({ ...DEFAULT_SETTINGS, ...value })).toThrow();
    }
  });
  it('canonicalizes shortcuts and detects collisions with defaults', () => {
    expect(normalizeShortcut('shift + ctrl + b')).toBe('Ctrl+Shift+B');
    expect(shortcutConflicts({ 'save-current-note': 'Ctrl+O' }).join()).toMatch(/Open (library|vault)/);
    expect(shortcutConflicts({ 'save-current-note': 'Ctrl+K' }).join()).toContain('Insert link');
    expect(shortcutConflicts({ 'save-current-note': 'F6' }).join()).toContain('navigation');
  });
  it('allows disabling a shortcut and resetting to defaults', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'save-current-note': '' } }).shortcuts).toEqual({
      'save-current-note': '',
    });
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
  it('detects contextual New conflicts while preserving explicitly rebound New notebook', () => {
    expect(shortcutConflicts({ 'new-notebook': 'Ctrl+N' }).join()).toContain('New notebook');
    const shortcuts = { 'new-contextual': '', 'new-notebook': 'Ctrl+N' };
    expect(validateSettings({ ...DEFAULT_SETTINGS, shortcuts }).shortcuts).toEqual(shortcuts);
    expect(validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'new-contextual': 'Ctrl+Alt+N' } }).shortcuts).toEqual({
      'new-contextual': 'Ctrl+Alt+N',
    });
  });
  it('rejects invalid settings and typing keys, and drops shortcuts for unknown commands', () => {
    expect(() => normalizeShortcut('b')).toThrow();
    expect(() => normalizeShortcut('Ctrl+Ctrl+B')).toThrow();
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, autosaveDelay: -1 })).toThrow();
    // A binding saved for a removed or renamed command must not fail the
    // whole file: it is dropped, and the surviving settings load.
    expect(
      validateSettings({
        ...DEFAULT_SETTINGS,
        shortcuts: { 'focus-main-content': 'Alt+2', 'show-calendar': 'Ctrl+6' },
        shortcutAliases: { 'focus-navigation': 'Alt+1' },
      }),
    ).toMatchObject({ shortcuts: { 'show-calendar': 'Ctrl+6' }, shortcutAliases: {} });
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'show-calendar': 6 } })).toThrow(
      /Invalid command shortcut/,
    );
  });
  it('validates idle and unsaved-edit lock timeouts with legacy defaults', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, vaultLockMinutes: 0, noteEditLockMinutes: 10 })).toMatchObject({
      vaultLockMinutes: 0,
      noteEditLockMinutes: 10,
    });
    expect(validateSettings({ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} })).toMatchObject({
      vaultLockMinutes: 15,
      noteEditLockMinutes: 0,
    });
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, vaultLockMinutes: 241 })).toThrow();
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, noteEditLockMinutes: -1 })).toThrow();
  });
  it('keeps F11 exclusive to Toggle Focus Mode without a reserved-key conflict', () => {
    // Regression: F11 was in RESERVED_SHORTCUTS while also the Toggle Focus
    // Mode registry primary, so saving any settings failed validation with
    // a shortcut conflict. The registry primary must validate clean, and a
    // second command claiming F11 must still be rejected.
    expect(validateSettings({ ...DEFAULT_SETTINGS, shortcuts: {} })).toMatchObject({ shortcuts: {} });
    expect(shortcutConflicts({}, {})).toEqual([]);
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'show-calendar': 'F11' } })).toThrow(
      /Shortcut conflicts: F11/,
    );
  });
});

describe('settings load failure messages', () => {
  it('names the vault read and validation failures distinctly', () => {
    expect(settingsLoadStatusMessage(new Error('settings-load: library-read-failed'))).toBe(
      'Could not load settings: the settings file could not be read.',
    );
    expect(settingsLoadStatusMessage(new Error('settings-load: library-validation-failed'))).toBe(
      'Could not load settings: the settings file failed its validity check.',
    );
  });

  it('appends the underlying validation error when the main process reports one', () => {
    expect(
      settingsLoadStatusMessage(new Error('settings-load: library-validation-failed: Invalid command shortcut.')),
    ).toBe('Could not load settings: the settings file failed its validity check (Invalid command shortcut).');
    expect(settingsLoadStatusMessage(new Error('settings-load: library-validation-failed: Invalid settings values.'))).toBe(
      'Could not load settings: the settings file failed its validity check (Invalid settings values).',
    );
  });

  it('keeps the generic message for unknown errors', () => {
    expect(settingsLoadStatusMessage(new Error('Settings unavailable.'))).toBe('Could not load settings.');
    expect(settingsLoadStatusMessage('boom')).toBe('Could not load settings.');
    expect(settingsLoadStatusMessage(undefined)).toBe('Could not load settings.');
  });
});

describe('settings load conflict tolerance', () => {
  it('still throws on shortcut conflicts in strict mode', () => {
    expect(() =>
      validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'context-bookmark': 'Ctrl+Shift+B' } }),
    ).toThrow(/Shortcut conflicts: Ctrl\+Shift\+B/);
  });

  it('keeps an explicit binding and unbinds the colliding default on load', () => {
    // Real case: Back up library defaults to Ctrl+Shift+B, and a stored
    // explicit Bookmark selected note binding claims the same key. The
    // explicit binding wins; Back up becomes unbound.
    const loaded = validateSettings(
      { ...DEFAULT_SETTINGS, shortcuts: { 'context-bookmark': 'Ctrl+Shift+B' } },
      { resolveConflictingShortcuts: true },
    );
    expect(loaded.shortcuts['context-bookmark']).toBe('Ctrl+Shift+B');
    expect(loaded.shortcuts['backup-library']).toBe('');
    expect(shortcutConflicts(loaded.shortcuts, loaded.shortcutAliases ?? {})).toEqual([]);
    expect(loaded.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('explicitly unbinds a default that collides with an earlier explicit binding', () => {
    // Back up library (earlier in the registry) explicitly claims
    // Ctrl+Shift+O, colliding with Open in external app's default.
    const loaded = validateSettings(
      { ...DEFAULT_SETTINGS, shortcuts: { 'backup-library': 'Ctrl+Shift+O' } },
      { resolveConflictingShortcuts: true },
    );
    expect(loaded.shortcuts['backup-library']).toBe('Ctrl+Shift+O');
    expect(loaded.shortcuts['open-selected-external']).toBe('');
    expect(shortcutConflicts(loaded.shortcuts, loaded.shortcutAliases ?? {})).toEqual([]);
  });

  it('drops the later of two colliding explicit bindings on load', () => {
    const loaded = validateSettings(
      {
        ...DEFAULT_SETTINGS,
        shortcuts: { 'show-calendar': 'Ctrl+Shift+X', 'show-about': 'Ctrl+Shift+X' },
      },
      { resolveConflictingShortcuts: true },
    );
    const remaining = (['show-calendar', 'show-about'] as const).filter(
      (id) => loaded.shortcuts[id] === 'Ctrl+Shift+X',
    );
    expect(remaining).toHaveLength(1);
    expect(shortcutConflicts(loaded.shortcuts, loaded.shortcutAliases ?? {})).toEqual([]);
  });

  it('keeps the showOriginalFiles setting boolean with a false default', () => {
    expect(DEFAULT_SETTINGS.showOriginalFiles).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, showOriginalFiles: true }).showOriginalFiles).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, showOriginalFiles: undefined }).showOriginalFiles).toBe(
      false,
    );
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, showOriginalFiles: 'yes' as never })).toThrow();
  });
});
