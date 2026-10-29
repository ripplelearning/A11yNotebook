import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  cycleFocusRegions,
  dispatchCommand,
  getCommandById,
  getContextMenuCommands,
  getKeyboardShortcuts,
  matchesShortcut,
  toAriaKeyShortcut,
  toMacAriaKeyShortcut,
  toMacShortcut,
  type CommandActionContext,
} from '../shared/command-registry';
import type { AppMode } from '../shared/types';

function createContext(overrides: Partial<CommandActionContext> = {}): CommandActionContext {
  return {
    mode: 'read-only',
    rightPaneOpen: true,
    setMode: vi.fn(),
    setRightPaneOpen: vi.fn(),
    setCommandPaletteOpen: vi.fn(),
    setSelectedTab: vi.fn(),
    saveNote: vi.fn(),
    showTasks: vi.fn(),
    toggleBookmark: vi.fn(),
    bookmarkHeadingAtCursor: vi.fn(),
    bookmarkPositionAtCursor: vi.fn(),
    focusTarget: vi.fn(),
    checkForUpdates: vi.fn(),
    showKeyboardShortcuts: vi.fn(),
    showAbout: vi.fn(),
    showFeedback: vi.fn(),
    showTutorial: vi.fn(),
    startFind: vi.fn(),
    repeatFind: vi.fn(),
    ...overrides,
  };
}

describe('command registry', () => {
  it('returns a command definition by id', () => {
    expect(getCommandById('toggle-read-only-mode')?.label).toBe('Toggle read-only/edit mode');
  });

  it('dispatches read-only mode toggles', () => {
    let currentMode: AppMode = 'read-only';
    const result = dispatchCommand(
      'toggle-read-only-mode',
      createContext({
        mode: currentMode,
        setMode: (value) => {
          currentMode = value;
        },
      }),
    );

    expect(result).toBe('Mode switched to edit.');
    expect(currentMode).toBe('edit');
  });

  it('dispatches direct reading mode and the find dialog', () => {
    let currentMode: AppMode = 'edit';
    const result = dispatchCommand(
      'enable-reading-mode',
      createContext({
        mode: currentMode,
        setMode: (value) => {
          currentMode = value;
        },
      }),
    );
    expect(result).toBe('Reading mode enabled.');
    expect(currentMode).toBe('read-only');
    const context = createContext();
    expect(dispatchCommand('find-in-document', context)).toBeUndefined();
    expect(context.startFind).toHaveBeenCalledTimes(1);
    expect(dispatchCommand('find-next', context)).toBeUndefined();
    expect(context.repeatFind).toHaveBeenCalledWith('next');
    expect(dispatchCommand('find-previous', context)).toBeUndefined();
    expect(context.repeatFind).toHaveBeenCalledWith('prev');
  });

  it('registers Help menu commands', () => {
    expect(getCommandById('check-for-updates')?.label).toBe('Check for Updates');
    expect(getCommandById('show-keyboard-shortcuts')?.label).toBe('Keyboard Shortcuts');
    expect(getCommandById('show-about')?.label).toBe('About A11y Notebook');
  });

  it('has unique command ids and labels', () => {
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
    expect(new Set(COMMANDS.map((command) => command.label)).size).toBe(COMMANDS.length);
  });

  it('dispatches each contextual creation command once', () => {
    const context = createContext({
      newContextual: vi.fn(),
      newLibrary: vi.fn(),
      newNote: vi.fn(),
      newTask: vi.fn(),
      newAsset: vi.fn(),
    });
    for (const id of ['new-contextual', 'new-library', 'new-note', 'new-task', 'new-asset'] as const) {
      expect(dispatchCommand(id, context)).toBeUndefined();
    }
    for (const callback of [
      context.newContextual,
      context.newLibrary,
      context.newNote,
      context.newTask,
      context.newAsset,
    ]) {
      expect(callback).toHaveBeenCalledTimes(1);
    }
    expect(getKeyboardShortcuts().filter(({ shortcut }) => shortcut === 'Ctrl+N')).toEqual([
      { commandId: 'new-contextual', label: 'New in current view', shortcut: 'Ctrl+N' },
    ]);
  });

  it('keeps legacy command names searchable and assigns Ctrl+K to Insert link only', () => {
    const openLibrary = getCommandById('open-vault');
    const commandSearch = getCommandById('command-search');

    expect(openLibrary?.aliases).toContain('Open library');
    expect(commandSearch?.aliases).toContain('Open command search');
    expect(commandSearch?.shortcut).toBe('Ctrl+Shift+P');
    expect(commandSearch?.shortcutAliases ?? []).not.toContain('Ctrl+K');
    expect(getCommandById('insert-link')?.shortcutAliases).toContain('Ctrl+K');
    expect(getKeyboardShortcuts()).toContainEqual({
      commandId: 'insert-link',
      label: 'Insert link',
      shortcut: 'Ctrl+K',
    });
    expect(getKeyboardShortcuts()).not.toContainEqual({
      commandId: 'command-search',
      label: 'Command Palette',
      shortcut: 'Ctrl+K',
    });
  });

  it('offers PDF annotation actions only in their matching contexts without conflicting default shortcuts', () => {
    expect(getContextMenuCommands('pdf-selection', true).map(({ id }) => id)).toEqual(['annotate-pdf-selection']);
    expect(getContextMenuCommands('pdf-selection', false)).toEqual([]);
    expect(getContextMenuCommands('pdf-semantic').map(({ id }) => id)).toEqual(['annotate-current-semantic-element']);
    expect(getContextMenuCommands('pdf-semantic', true).map(({ id }) => id)).toEqual([
      'annotate-pdf-selection',
      'annotate-current-semantic-element',
    ]);
    expect(getContextMenuCommands('editor-selection', true).map(({ id }) => id)).not.toContain(
      'annotate-pdf-selection',
    );
    // No default shortcut is shared: Ctrl+K belongs to Insert link only,
    // and the Command Palette is Ctrl+Shift+P.
    const shortcuts = getKeyboardShortcuts();
    const byShortcut = new Map<string, string[]>();
    for (const { commandId, shortcut } of shortcuts) {
      byShortcut.set(shortcut, [...(byShortcut.get(shortcut) ?? []), commandId]);
    }
    const duplicates = [...byShortcut.entries()].filter(([, ids]) => ids.length > 1);
    expect(duplicates).toEqual([]);
  });

  it('lists exactly one import row by default: Import file. Import managed copy appears only with an assigned key', () => {
    // Import file brings a file from outside the library into a notebook;
    // Import managed copy makes a managed copy of a file already in the
    // library. They start from different places, so both commands stay,
    // but the Shortcuts Manager shows a command only when it has a key.
    const defaults = getKeyboardShortcuts().filter(({ label }) => label.toLowerCase().includes('import'));
    expect(defaults).toEqual([{ commandId: 'import-file', label: 'Import file', shortcut: 'Ctrl+Shift+I' }]);
    const assigned = getKeyboardShortcuts({ 'context-import-note': 'Ctrl+Shift+M' }).filter(({ label }) =>
      label.toLowerCase().includes('import'),
    );
    expect(assigned.map(({ label }) => label)).toEqual(['Import file', 'Import managed copy…']);
  });

  it('dispatches check-for-updates to the updater', () => {
    const context = createContext();
    expect(dispatchCommand('check-for-updates', context)).toBeUndefined();
    expect(context.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('moves focus for focus commands without a duplicate status message', () => {
    const context = createContext();
    expect(dispatchCommand('focus-search', context)).toBeUndefined();
    expect(context.focusTarget).toHaveBeenNthCalledWith(1, 'search');
  });

  it('lists keyboard shortcuts for commands that have one', () => {
    const shortcuts = getKeyboardShortcuts();
    expect(shortcuts).toContainEqual({
      commandId: 'command-search',
      label: 'Command Palette',
      shortcut: 'Ctrl+Shift+P',
    });
    expect(shortcuts.every((item) => item.shortcut.length > 0)).toBe(true);
  });

  it('builds context-specific menus from registry metadata and retains disabled selection actions', () => {
    expect(getContextMenuCommands('tree-note').map(({ id }) => id)).toContain('context-bookmark');
    expect(getContextMenuCommands('tree-folder').map(({ id }) => id)).toContain('context-new-note');
    expect(getContextMenuCommands('tree-folder').map(({ id }) => id)).not.toContain('context-bookmark');
    expect(getContextMenuCommands('tab').map(({ id }) => id)).toContain('context-close-other-tabs');
    expect(getContextMenuCommands('reader-link').map(({ id }) => id)).toContain('context-copy-link');
    expect(getContextMenuCommands('task-row').map(({ id }) => id)).toContain('context-set-due-date');
    expect(getContextMenuCommands('task-row').map(({ id }) => id)).toContain('context-set-priority');
    expect(getContextMenuCommands('search-result').map(({ id }) => id)).toContain('context-open');
    expect(getContextMenuCommands('annotation').map(({ id }) => id)).toContain('context-delete');
    expect(getContextMenuCommands('reminder').map(({ id }) => id)).toContain('context-delete');
    expect(getContextMenuCommands('attachment').map(({ id }) => id)).toContain('context-reveal');
    expect(getContextMenuCommands('attachment').map(({ id }) => id)).toContain('context-delete');
    expect(getContextMenuCommands('document-preview').map(({ id }) => id)).toContain('context-open-external');
    expect(getContextMenuCommands('editor-selection', false).map(({ id }) => id)).toContain('context-copy');
    expect(getContextMenuCommands('editor-selection', true).map(({ id }) => id)).toContain('format-bold');
    expect(getContextMenuCommands('general').map(({ id }) => id)).toContain('open-vault');
  });
});

describe('keyboard shortcut matching', () => {
  const key = (
    value: string,
    modifiers: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {},
  ) => ({
    key: value,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  });

  it('matches modifiers exactly', () => {
    expect(matchesShortcut(key('k', { ctrlKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesShortcut(key('K', { ctrlKey: true, shiftKey: true }), 'Ctrl+K')).toBe(false);
    expect(matchesShortcut(key('k'), 'Ctrl+K')).toBe(false);
    expect(matchesShortcut(key('F9'), 'F9')).toBe(true);
    expect(matchesShortcut(key('1', { altKey: true }), 'Alt+1')).toBe(true);
  });

  it('maps Command to Ctrl on macOS and never fires on physical Ctrl', () => {
    expect(matchesShortcut(key('k', { metaKey: true }), 'Ctrl+K', true)).toBe(true);
    expect(matchesShortcut(key('k', { ctrlKey: true }), 'Ctrl+K', true)).toBe(false);
    // VoiceOver's Ctrl+Option modifier must not fire a Ctrl+Alt command.
    expect(matchesShortcut(key('h', { ctrlKey: true, altKey: true }), 'Ctrl+Alt+H', true)).toBe(false);
    expect(matchesShortcut(key('h', { metaKey: true, altKey: true }), 'Ctrl+Alt+H', true)).toBe(true);
    expect(matchesShortcut(key('k', { metaKey: true, ctrlKey: true }), 'Ctrl+K', true)).toBe(false);
  });

  it('converts shortcuts to macOS display and aria formats', () => {
    expect(toMacShortcut('Ctrl+Alt+H')).toBe('Command+Option+H');
    expect(toMacAriaKeyShortcut('Ctrl+Shift+K')).toBe('Meta+Shift+K');
  });

  it('converts shortcuts to aria-keyshortcuts format', () => {
    expect(toAriaKeyShortcut('Ctrl+K')).toBe('Control+K');
    expect(toAriaKeyShortcut('F1')).toBe('F1');
  });
});

describe('focus region cycling', () => {
  it('moves forward through navigation, tabs, main, right pane, and status', () => {
    expect(cycleFocusRegions('navigation', 'forward')).toBe('tabs');
    expect(cycleFocusRegions('tabs', 'forward')).toBe('main');
    expect(cycleFocusRegions('main', 'forward')).toBe('right-pane');
    expect(cycleFocusRegions('right-pane', 'forward')).toBe('status');
    expect(cycleFocusRegions('status', 'forward')).toBe('navigation');
  });

  it('moves backward through the main focus regions', () => {
    expect(cycleFocusRegions('navigation', 'backward')).toBe('status');
    expect(cycleFocusRegions('main', 'backward')).toBe('tabs');
  });

  it('skips regions that are not available', () => {
    const available = ['navigation', 'tabs', 'main', 'status'] as const;
    expect(cycleFocusRegions('main', 'forward', available)).toBe('status');
    expect(cycleFocusRegions('status', 'backward', available)).toBe('main');
    expect(cycleFocusRegions('right-pane', 'forward', available)).toBe('status');
  });
});

describe('batch 1 fixes (1.9.4)', () => {
  it('merges the duplicate internal import into the managed-copy import', () => {
    expect(COMMANDS.some((command) => (command.id as string) === 'context-import-internal')).toBe(false);
    const managed = getCommandById('context-import-note');
    expect(managed?.contexts).toEqual(
      expect.arrayContaining(['tree-note', 'attachment', 'document-preview', 'search-result']),
    );
    expect(getContextMenuCommands('document-preview').map(({ id }) => id)).toContain('context-import-note');
    expect(getContextMenuCommands('search-result').map(({ id }) => id)).toContain('context-import-note');
  });

  it('opens reminders with Ctrl+7 and keeps the old shortcut as an alias', () => {
    expect(getCommandById('show-reminders')?.shortcut).toBe('Ctrl+7');
    expect(getCommandById('show-reminders')?.shortcutAliases).toContain('Ctrl+Shift+R');
  });

  it('offers Reveal in Explorer from a note tab', () => {
    expect(getCommandById('context-reveal')?.contexts).toContain('tab');
    expect(getContextMenuCommands('tab').map(({ id }) => id)).toContain('context-reveal');
  });
});
