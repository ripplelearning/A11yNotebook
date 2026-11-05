import { describe, expect, it } from 'vitest';
import {
  defaultShortcut,
  getCommandById,
  getContextMenuCommands,
  getKeyboardShortcuts,
} from '../shared/command-registry';
import { shortcutConflicts } from '../shared/settings';

describe('add-link command defaults', () => {
  it('binds Ctrl+Alt+L on every platform', () => {
    const command = getCommandById('add-link');
    expect(command?.label).toBe('Add link');
    expect(defaultShortcut(command!)).toBe('Ctrl+Alt+L');
    expect(defaultShortcut(command!, true)).toBe('Ctrl+Alt+L');
    expect(getKeyboardShortcuts()).toContainEqual({ commandId: 'add-link', label: 'Add link', shortcut: 'Ctrl+Alt+L' });
  });

  it('reports Ctrl+Alt+L as taken when another command claims it', () => {
    expect(shortcutConflicts({ 'show-tasks': 'Ctrl+Alt+L' }, {}, false)).toContain(
      'Ctrl+Alt+L: Add link (add-link) and Tasks (show-tasks)',
    );
  });

  it('gives edit-link no shortcut of its own', () => {
    expect(getCommandById('edit-link')?.label).toBe('Edit link');
    expect(getKeyboardShortcuts().some((item) => item.commandId === 'edit-link')).toBe(false);
  });
});

describe('link context menu', () => {
  it('offers opening, editing, renaming, moving, deleting, revealing, protecting, properties, and email — and nothing else', () => {
    const labels = getContextMenuCommands('link').map((command) => command.label);
    expect(labels).toEqual([
      'Open selected item',
      'Edit link',
      'Rename selected item',
      'Move selected item',
      'Delete selected item',
      'Reveal this item in Explorer',
      'Protect selected item',
      'Properties',
      'Send to email',
    ]);
  });
});
