import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeShortcut, shortcutConflicts, validateSettings } from '../shared/settings';

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
  it('rejects invalid settings, typing keys and unknown commands', () => {
    expect(() => normalizeShortcut('b')).toThrow();
    expect(() => normalizeShortcut('Ctrl+Ctrl+B')).toThrow();
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, autosaveDelay: -1 })).toThrow();
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { bad: 'Ctrl+T' } })).toThrow();
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
});
