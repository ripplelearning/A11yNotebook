import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  effectiveShortcutAliases,
  getKeyboardShortcuts,
} from '../shared/command-registry';
import { shortcutConflicts, validateSettings, DEFAULT_SETTINGS } from '../shared/settings';

const insertLink = COMMANDS.find((command) => command.id === 'insert-link')!;

describe('shortcut aliases and duplicate detection', () => {
  it('keeps the registry alias by default and honors an override or disable', () => {
    expect(effectiveShortcutAliases(insertLink)).toEqual(['Ctrl+K']);
    expect(effectiveShortcutAliases(insertLink, { 'insert-link': 'Ctrl+Alt+K' })).toEqual(['Ctrl+Alt+K']);
    expect(effectiveShortcutAliases(insertLink, { 'insert-link': '' })).toEqual([]);
  });

  it('shows the effective alias in the shortcuts list and drops a disabled one', () => {
    expect(getKeyboardShortcuts().find((row) => row.shortcut === 'Ctrl+K')?.commandId).toBe('insert-link');
    expect(
      getKeyboardShortcuts({}, { 'insert-link': 'Ctrl+Alt+K' }).find((row) => row.shortcut === 'Ctrl+Alt+K')
        ?.commandId,
    ).toBe('insert-link');
    expect(
      getKeyboardShortcuts({}, { 'insert-link': '' }).some((row) => row.shortcut === 'Ctrl+K'),
    ).toBe(false);
  });

  it('rejects a shortcut that collides with another command’s alias, unless the alias is disabled', () => {
    expect(shortcutConflicts({ 'show-about': 'Ctrl+K' })).toHaveLength(1);
    expect(shortcutConflicts({ 'show-about': 'Ctrl+K' })[0]).toContain('insert-link');
    expect(shortcutConflicts({ 'show-about': 'Ctrl+K' }, { 'insert-link': '' })).toEqual([]);
  });

  it('rejects identical primary assignments and names both commands', () => {
    const conflicts = shortcutConflicts({ 'show-about': 'Ctrl+S' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('save-current-note');
    expect(conflicts[0]).toContain('show-about');
  });

  it('rejects duplicate assignments on settings save', () => {
    expect(() =>
      validateSettings({ ...DEFAULT_SETTINGS, shortcuts: { 'show-about': 'Ctrl+S' } }),
    ).toThrow(/Shortcut conflicts/);
  });

  it('gives the new general and format commands unique defaults', () => {
    const byId = new Map(COMMANDS.map((command) => [command.id, command.shortcut]));
    expect(byId.get('format-heading1')).toBe('Ctrl+Alt+1');
    expect(byId.get('format-heading6')).toBe('Ctrl+Alt+6');
    expect(byId.get('backup-library')).toBe('Ctrl+Shift+B');
    const bindings = COMMANDS.flatMap((command) => (command.shortcut ? [command.shortcut] : []));
    expect(new Set(bindings).size).toBe(bindings.length);
  });
});
