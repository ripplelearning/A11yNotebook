import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  cycleFocusRegions,
  dispatchCommand,
  getCommandById,
  getKeyboardShortcuts,
  matchesShortcut,
  toAriaKeyShortcut,
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
    focusTarget: vi.fn(),
    checkForUpdates: vi.fn(),
    showKeyboardShortcuts: vi.fn(),
    showAbout: vi.fn(),
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

  it('registers Help menu commands', () => {
    expect(getCommandById('check-for-updates')?.label).toBe('Check for Updates');
    expect(getCommandById('show-keyboard-shortcuts')?.label).toBe('Keyboard Shortcuts');
    expect(getCommandById('show-about')?.label).toBe('About A11y Notebook');
  });

  it('has unique command ids and labels', () => {
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
    expect(new Set(COMMANDS.map((command) => command.label)).size).toBe(COMMANDS.length);
  });

  it('dispatches check-for-updates to the updater', () => {
    const context = createContext();
    expect(dispatchCommand('check-for-updates', context)).toBeUndefined();
    expect(context.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('moves focus for focus commands without a duplicate status message', () => {
    const context = createContext();
    expect(dispatchCommand('focus-search', context)).toBeUndefined();
    expect(dispatchCommand('focus-navigation', context)).toBeUndefined();
    expect(dispatchCommand('focus-main-content', context)).toBeUndefined();
    expect(context.focusTarget).toHaveBeenNthCalledWith(1, 'search');
    expect(context.focusTarget).toHaveBeenNthCalledWith(2, 'navigation');
    expect(context.focusTarget).toHaveBeenNthCalledWith(3, 'main');
  });

  it('opens a hidden right pane before focusing it', () => {
    const context = createContext({ rightPaneOpen: false });
    dispatchCommand('focus-right-pane', context);
    expect(context.setRightPaneOpen).toHaveBeenCalledWith(true);
    expect(context.focusTarget).toHaveBeenCalledWith('right-pane');
  });

  it('lists keyboard shortcuts for commands that have one', () => {
    const shortcuts = getKeyboardShortcuts();
    expect(shortcuts).toContainEqual({ commandId: 'command-search', label: 'Open command search', shortcut: 'Ctrl+K' });
    expect(shortcuts.every((item) => item.shortcut.length > 0)).toBe(true);
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
