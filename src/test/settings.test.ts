import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeShortcut, shortcutConflicts, validateSettings } from '../shared/settings';

describe('settings and shortcut validation', () => {
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
    expect(shortcutConflicts({ 'save-current-note': 'Ctrl+O' }).join()).toContain('Open vault');
    expect(shortcutConflicts({ 'save-current-note': 'F6' }).join()).toContain('navigation');
  });
  it('allows disabling a shortcut and resetting to defaults', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'save-current-note': '' } }).shortcuts).toEqual({
      'save-current-note': '',
    });
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
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
