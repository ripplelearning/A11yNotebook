import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeShortcut, shortcutConflicts, validateSettings } from '../shared/settings';

describe('settings and shortcut validation', () => {
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
});
