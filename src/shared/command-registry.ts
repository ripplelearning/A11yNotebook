import type { AppMode, FocusRegion, FocusTarget } from './types';

export type CommandId =
  | 'open-vault'
  | 'new-notebook'
  | 'save-current-note'
  | 'show-tasks'
  | 'toggle-bookmark'
  | 'close-current-tab'
  | 'toggle-read-only-mode'
  | 'toggle-right-pane'
  | 'focus-search'
  | 'focus-navigation'
  | 'focus-main-content'
  | 'focus-right-pane'
  | 'command-search'
  | 'refresh-links'
  | 'show-keyboard-shortcuts'
  | 'check-for-updates'
  | 'show-about'
  | 'show-settings'
  | 'new-from-template'
  | 'annotate-selection'
  | 'show-reminders'
  | 'show-assets'
  | 'format-bold'
  | 'format-italic'
  | 'format-heading1'
  | 'format-heading2'
  | 'format-heading3'
  | 'format-bullet'
  | 'format-numbered'
  | 'format-checkbox'
  | 'format-quote'
  | 'format-code'
  | 'insert-link'
  | 'insert-table'
  | 'insert-attachment';

export type CommandActionContext = {
  mode: AppMode;
  rightPaneOpen: boolean;
  setMode: (value: AppMode) => void;
  setRightPaneOpen: (value: boolean) => void;
  setCommandPaletteOpen: (value: boolean) => void;
  setSelectedTab: (value: string) => void;
  saveNote: () => void;
  showTasks: () => void;
  toggleBookmark: () => void;
  /** Move keyboard focus to a region or control of the shell. */
  focusTarget: (target: FocusTarget) => void;
  checkForUpdates: () => void;
  showKeyboardShortcuts: () => void;
  showAbout: () => void;
};

export type CommandDefinition = {
  id: CommandId;
  label: string;
  description: string;
  shortcut?: string;
};

export type KeyboardShortcutDefinition = {
  commandId: CommandId;
  label: string;
  shortcut: string;
};

export const COMMANDS: CommandDefinition[] = [
  {
    id: 'insert-attachment',
    label: 'Insert image or attachment',
    description: 'Insert a labelled reference to a vault attachment.',
  },
  {
    id: 'show-settings',
    label: 'Settings',
    description: 'Customize autosave, appearance, and keyboard shortcuts.',
    shortcut: 'Ctrl+Alt+S',
  },
  {
    id: 'new-from-template',
    label: 'New note from template',
    description: 'Choose a built-in or vault template.',
    shortcut: 'Ctrl+Shift+N',
  },
  {
    id: 'annotate-selection',
    label: 'Annotate selection',
    description: 'Highlight selected reading text with a label and comment.',
    shortcut: 'Ctrl+Shift+A',
  },
  {
    id: 'show-reminders',
    label: 'Open Reminders',
    description: 'Show reminders and the grouped agenda.',
    shortcut: 'Ctrl+Shift+R',
  },
  {
    id: 'show-assets',
    label: 'Cognitive tools',
    description: 'Edit outlines, mind maps, tables, and review flashcards.',
  },
  { id: 'format-bold', label: 'Bold', description: 'Format the editor selection as bold.', shortcut: 'Ctrl+B' },
  { id: 'format-italic', label: 'Italic', description: 'Format the editor selection as italic.', shortcut: 'Ctrl+I' },
  { id: 'format-heading1', label: 'Heading 1', description: 'Format selected lines as level-one headings.' },
  { id: 'format-heading2', label: 'Heading 2', description: 'Format selected lines as level-two headings.' },
  { id: 'format-heading3', label: 'Heading 3', description: 'Format selected lines as level-three headings.' },
  { id: 'format-bullet', label: 'Bulleted list', description: 'Format selected lines as a bullet list.' },
  { id: 'format-numbered', label: 'Numbered list', description: 'Format selected lines as a numbered list.' },
  { id: 'format-checkbox', label: 'Checkbox list', description: 'Format selected lines as checkbox tasks.' },
  { id: 'format-quote', label: 'Quote', description: 'Format selected lines as a quote.' },
  { id: 'format-code', label: 'Code block', description: 'Wrap selected text in a fenced code block.' },
  {
    id: 'insert-link',
    label: 'Insert link',
    description: 'Insert a web or wiki link with a labelled dialog.',
    shortcut: 'Ctrl+Shift+L',
  },
  { id: 'insert-table', label: 'Insert table', description: 'Choose Markdown table rows and columns.' },
  {
    id: 'open-vault',
    label: 'Open vault',
    description: 'Select and open a vault from local storage.',
    shortcut: 'Ctrl+O',
  },
  {
    id: 'new-notebook',
    label: 'New notebook',
    description: 'Create a new notebook entry within the current vault.',
    shortcut: 'Ctrl+N',
  },
  {
    id: 'save-current-note',
    label: 'Save note',
    description: 'Save changes to the active Markdown note.',
    shortcut: 'Ctrl+S',
  },
  {
    id: 'show-tasks',
    label: 'Open Tasks',
    description: 'Open the accessible task list for this vault.',
  },
  {
    id: 'toggle-bookmark',
    label: 'Toggle note bookmark',
    description: 'Add or remove a bookmark for the active note.',
    shortcut: 'Ctrl+D',
  },
  { id: 'close-current-tab', label: 'Close current tab', description: 'Close the active tab.', shortcut: 'Ctrl+W' },
  {
    id: 'toggle-read-only-mode',
    label: 'Toggle read-only/edit mode',
    description: 'Switch between read-only and edit mode.',
    shortcut: 'Ctrl+E',
  },
  {
    id: 'toggle-right-pane',
    label: 'Toggle right pane',
    description: 'Show or hide the right information pane.',
    shortcut: 'F9',
  },
  {
    id: 'focus-search',
    label: 'Focus search',
    description: 'Move focus to the global search box.',
    shortcut: 'Ctrl+L',
  },
  {
    id: 'focus-navigation',
    label: 'Focus navigation',
    description: 'Move focus to the navigation pane.',
    shortcut: 'Alt+1',
  },
  {
    id: 'focus-main-content',
    label: 'Focus main content',
    description: 'Move focus to the content pane.',
    shortcut: 'Alt+2',
  },
  {
    id: 'focus-right-pane',
    label: 'Focus right pane',
    description: 'Move focus to the right pane.',
    shortcut: 'Alt+3',
  },
  {
    id: 'command-search',
    label: 'Open command search',
    description: 'Open the command palette to run key commands.',
    shortcut: 'Ctrl+K',
  },
  {
    id: 'refresh-links',
    label: 'Refresh links',
    description: 'Rescan the vault and rebuild local links and backlinks.',
    shortcut: 'F5',
  },
  {
    id: 'show-keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    description: 'Display keyboard shortcuts and navigation help.',
    shortcut: 'F1',
  },
  {
    id: 'check-for-updates',
    label: 'Check for Updates',
    description: 'Check the A11y Notebook GitHub releases for a newer version and install it.',
  },
  {
    id: 'show-about',
    label: 'About A11y Notebook',
    description: 'Show the application name, version, and repository link.',
  },
];

/** Pane order used by F6 (forward) and Shift+F6 (backward). */
export const FOCUS_REGION_ORDER: readonly FocusRegion[] = ['navigation', 'tabs', 'main', 'right-pane', 'status'];

export function getCommandById(commandId: CommandId) {
  return COMMANDS.find((command) => command.id === commandId);
}

export function getKeyboardShortcuts(): KeyboardShortcutDefinition[] {
  return COMMANDS.filter((command) => command.shortcut).map((command) => ({
    commandId: command.id,
    label: command.label,
    shortcut: command.shortcut as string,
  }));
}

/**
 * Return the next focus region in the given direction, skipping regions that are
 * not currently available (for example, the right pane when it is hidden).
 */
export function cycleFocusRegions(
  current: FocusRegion,
  direction: 'forward' | 'backward' = 'forward',
  available: readonly FocusRegion[] = FOCUS_REGION_ORDER,
): FocusRegion {
  const order = FOCUS_REGION_ORDER;
  const step = direction === 'forward' ? 1 : -1;
  const start = order.indexOf(current);
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(start + step * offset + order.length * 2) % order.length];
    if (available.includes(candidate)) {
      return candidate;
    }
  }
  return current;
}

type ShortcutKeyEvent = { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean };

/** Check whether a keyboard event matches a shortcut string such as "Ctrl+K" or "F9". */
export function matchesShortcut(event: ShortcutKeyEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  if (!key) {
    return false;
  }
  return (
    event.key.toLowerCase() === key &&
    event.ctrlKey === parts.includes('ctrl') &&
    event.altKey === parts.includes('alt') &&
    event.shiftKey === parts.includes('shift') &&
    !event.metaKey
  );
}

/** Convert "Ctrl+K" into the aria-keyshortcuts format "Control+K". */
export function toAriaKeyShortcut(shortcut: string): string {
  return shortcut.replace(/\bCtrl\b/g, 'Control');
}

/**
 * Run a command. Returns a message for the status bar live region, or undefined when
 * the result is already conveyed another way (for example, by moving focus).
 */
export function dispatchCommand(commandId: CommandId, context: CommandActionContext): string | undefined {
  switch (commandId) {
    case 'open-vault':
      return 'Open vault dialog ready.';
    case 'new-notebook':
      return 'New notebook created in the current vault.';
    case 'save-current-note':
      context.saveNote();
      return undefined;
    case 'show-tasks':
      context.showTasks();
      return undefined;
    case 'toggle-bookmark':
      context.toggleBookmark();
      return undefined;
    case 'close-current-tab':
      context.setSelectedTab('welcome');
      return 'Current tab closed.';
    case 'toggle-read-only-mode': {
      const nextMode: AppMode = context.mode === 'read-only' ? 'edit' : 'read-only';
      context.setMode(nextMode);
      return `Mode switched to ${nextMode}.`;
    }
    case 'toggle-right-pane': {
      const nextState = !context.rightPaneOpen;
      context.setRightPaneOpen(nextState);
      return nextState ? 'Right pane opened.' : 'Right pane closed.';
    }
    case 'focus-search':
      context.focusTarget('search');
      return undefined;
    case 'focus-navigation':
      context.focusTarget('navigation');
      return undefined;
    case 'focus-main-content':
      context.focusTarget('main');
      return undefined;
    case 'focus-right-pane':
      if (!context.rightPaneOpen) {
        context.setRightPaneOpen(true);
      }
      context.focusTarget('right-pane');
      return undefined;
    case 'command-search':
      context.setCommandPaletteOpen(true);
      return undefined;
    case 'refresh-links':
      return 'Vault and links refreshed.';
    case 'show-keyboard-shortcuts':
      context.showKeyboardShortcuts();
      return undefined;
    case 'check-for-updates':
      context.checkForUpdates();
      return undefined;
    case 'show-about':
      context.showAbout();
      return undefined;
    default:
      return 'Command not recognized.';
  }
}
