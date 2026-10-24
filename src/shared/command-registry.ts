import type { AppMode, FocusRegion, FocusTarget } from './types';

export type CommandId =
  | 'navigate-back'
  | 'navigate-forward'
  | 'show-contents'
  | 'show-libraries'
  | 'show-notebooks'
  | 'show-notes-files'
  | 'open-vault'
  | 'new-contextual'
  | 'new-notebook'
  | 'new-library'
  | 'new-note'
  | 'import-file'
  | 'open-selected-external'
  | 'new-task'
  | 'new-asset'
  | 'context-import-note'
  | 'context-open-with'
  | 'context-open-with-default'
  | 'save-current-note'
  | 'edit-undo'
  | 'edit-redo'
  | 'show-tasks'
  | 'toggle-bookmark'
  | 'edit-note-metadata'
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
  | 'annotate-pdf-selection'
  | 'annotate-current-semantic-element'
  | 'show-reminders'
  | 'show-milestones'
  | 'show-assets'
  | 'format-bold'
  | 'format-italic'
  | 'format-heading1'
  | 'format-heading2'
  | 'format-heading3'
  | 'format-heading4'
  | 'format-heading5'
  | 'format-heading6'
  | 'format-bullet'
  | 'format-numbered'
  | 'format-checkbox'
  | 'format-quote'
  | 'format-code'
  | 'insert-link'
  | 'insert-table'
  | 'insert-attachment'
  | 'context-open'
  | 'context-rename'
  | 'context-move'
  | 'context-delete'
  | 'context-reveal'
  | 'context-bookmark'
  | 'context-new-note'
  | 'context-close-tab'
  | 'context-close-other-tabs'
  | 'context-pin-tab'
  | 'context-cut'
  | 'context-copy'
  | 'context-paste'
  | 'context-open-external'
  | 'context-import-internal'
  | 'context-copy-link'
  | 'context-toggle-task'
  | 'context-set-due-date'
  | 'context-open-source'
  | 'context-encrypt-note'
  | 'context-export-note'
  | 'export-current-note'
  | 'capture-webpage'
  | 'import-file'
  | 'reveal-selected'
  | 'open-selected-external'
  | 'encrypt-current-note'
  | 'convert-current-note'
  | 'convert-note-to-outline';

export type MenuContext =
  | 'general'
  | 'tree-note'
  | 'tree-folder'
  | 'tab'
  | 'editor-selection'
  | 'reader-link'
  | 'task-row'
  | 'search-result'
  | 'annotation'
  | 'reminder'
  | 'attachment'
  | 'document-preview'
  | 'pdf-selection'
  | 'pdf-semantic';

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
  navigateBack?: () => void;
  navigateForward?: () => void;
  showContents?: () => void;
  showLibraries?: () => void;
  showNotebooks?: () => void;
  showNotesFiles?: () => void;
  showAssets?: () => void;
  showSettings?: () => void;
  openVault?: () => void;
  newNotebook?: () => void;
  newContextual?: () => void;
  newLibrary?: () => void;
  newNote?: () => void;
  newTask?: () => void;
  newAsset?: () => void;
  exportCurrentNote?: () => void;
};

export type CommandDefinition = {
  id: CommandId;
  label: string;
  aliases?: readonly string[];
  description: string;
  shortcut?: string;
  shortcutAliases?: readonly string[];
  contexts?: readonly MenuContext[];
  requiresSelection?: boolean;
};

export type KeyboardShortcutDefinition = {
  commandId: CommandId;
  label: string;
  shortcut: string;
};

export const COMMANDS: CommandDefinition[] = [
  {
    id: 'new-contextual',
    label: 'New',
    description: 'Create an item in the current view.',
    shortcut: 'Ctrl+N',
    contexts: ['general'],
  },
  { id: 'new-library', label: 'New library', description: 'Create a new local library.', contexts: ['general'] },
  { id: 'new-note', label: 'New note', description: 'Create a note in the selected notebook.', contexts: ['general'] },
  {
    id: 'open-selected-external',
    label: 'Open in external app',
    description: 'Open the selected library file in its default application.',
    contexts: ['general'],
  },
  {
    id: 'import-file',
    label: 'Import file',
    description: 'Import an external file into the selected notebook.',
    contexts: ['general'],
  },
  {
    id: 'new-task',
    label: 'New task',
    description: 'Add a persisted task to an associated note.',
    contexts: ['general'],
  },
  {
    id: 'new-asset',
    label: 'New cognitive tool',
    description: 'Choose a cognitive tool type and create it.',
    contexts: ['general'],
  },
  {
    id: 'show-contents',
    label: 'Contents',
    description: 'Show the contents overview.',
    shortcut: 'Ctrl+0',
    contexts: ['general'],
  },
  {
    id: 'show-libraries',
    label: 'Libraries',
    description: 'Show and manage libraries.',
    shortcut: 'Ctrl+1',
    contexts: ['general'],
  },
  {
    id: 'show-notebooks',
    label: 'Notebooks',
    description: 'Show and manage notebooks in the current library.',
    shortcut: 'Ctrl+2',
    contexts: ['general'],
  },
  {
    id: 'show-notes-files',
    label: 'Notes & Files',
    description: 'Show and manage notes and files.',
    shortcut: 'Ctrl+3',
    contexts: ['general'],
  },
  {
    id: 'navigate-back',
    label: 'Back',
    description: 'Go back to the previous view in browsing history.',
    shortcut: 'Alt+ArrowLeft',
    contexts: ['general'],
  },
  {
    id: 'navigate-forward',
    label: 'Forward',
    description: 'Go forward to the next view in browsing history.',
    shortcut: 'Alt+ArrowRight',
    contexts: ['general'],
  },
  {
    id: 'context-open',
    label: 'Open',
    description: 'Open the focused item.',
    contexts: ['tree-note', 'search-result', 'annotation', 'reminder', 'reader-link', 'document-preview'],
  },
  {
    id: 'context-import-note',
    label: 'Import into A11y Notebook…',
    description:
      'Import a managed copy. Markdown and HTML notes are editable; documents and images use read-only previews, and cognitive assets use their dedicated editors.',
    contexts: ['tree-note', 'attachment'],
  },
  {
    id: 'context-open-with',
    label: 'Open With…',
    description: 'Choose an external application for this file.',
    contexts: ['tree-note', 'attachment'],
  },
  {
    id: 'context-open-with-default',
    label: 'Choose default application…',
    description: 'Choose the Windows default application for this file type.',
    contexts: ['tree-note', 'attachment'],
  },
  {
    id: 'context-rename',
    label: 'Rename',
    description: 'Rename the selected library item.',
    contexts: ['tree-note', 'tree-folder'],
  },
  {
    id: 'context-move',
    label: 'Move',
    description: 'Move the selected library item.',
    contexts: ['tree-note', 'tree-folder'],
  },
  {
    id: 'context-delete',
    label: 'Delete',
    description: 'Delete the selected library item.',
    contexts: ['tree-note', 'tree-folder', 'attachment', 'annotation', 'reminder'],
  },
  {
    id: 'context-reveal',
    label: 'Reveal in Explorer',
    description: 'Reveal the selected library item.',
    contexts: ['tree-note', 'tree-folder', 'attachment'],
  },
  {
    id: 'context-import-internal',
    label: 'Import into A11y Notebook',
    description: 'Import a separate compatible copy for internal reading or editing.',
    contexts: ['tree-note', 'attachment', 'document-preview', 'search-result'],
  },
  {
    id: 'context-bookmark',
    label: 'Bookmark',
    description: 'Toggle a bookmark for the selected note.',
    contexts: ['tree-note'],
  },
  {
    id: 'context-new-note',
    label: 'New note in notebook',
    description: 'Create a note in this notebook.',
    contexts: ['tree-folder'],
  },
  { id: 'context-close-tab', label: 'Close tab', description: 'Close this tab.', contexts: ['tab'] },
  {
    id: 'context-close-other-tabs',
    label: 'Close other tabs',
    description: 'Close all other unpinned tabs.',
    contexts: ['tab'],
  },
  {
    id: 'context-pin-tab',
    label: 'Pin tab',
    description: 'Keep this tab open when closing other tabs.',
    contexts: ['tab'],
  },
  {
    id: 'context-cut',
    label: 'Cut',
    description: 'Cut the selected text.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'context-copy',
    label: 'Copy',
    description: 'Copy the selected text.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  { id: 'context-paste', label: 'Paste', description: 'Paste text into the editor.', contexts: ['editor-selection'] },
  {
    id: 'context-open-external',
    label: 'Open external link',
    description: 'Open the link in the default application.',
    contexts: ['reader-link', 'attachment', 'document-preview'],
  },
  { id: 'context-copy-link', label: 'Copy link', description: 'Copy the link address.', contexts: ['reader-link'] },
  {
    id: 'context-toggle-task',
    label: 'Toggle task',
    description: 'Change the task completion state.',
    contexts: ['task-row'],
  },
  {
    id: 'context-set-due-date',
    label: 'Set due date',
    description: 'Set a due date for this task.',
    contexts: ['task-row'],
  },
  {
    id: 'context-open-source',
    label: 'Open source note',
    description: 'Open the note containing this task.',
    contexts: ['task-row'],
  },
  {
    id: 'context-encrypt-note',
    label: 'Encrypt note',
    description: 'Protect this note with a separate password.',
    contexts: ['tree-note', 'editor-selection'],
  },
  {
    id: 'context-export-note',
    label: 'Export note…',
    description: 'Export this note as standalone HTML or Markdown.',
    contexts: ['tree-note', 'tab'],
  },
  {
    id: 'export-current-note',
    label: 'Export current note…',
    description: 'Export the current note as standalone HTML or Markdown.',
    contexts: ['general'],
  },
  { id: 'capture-webpage', label: 'Capture webpage…', description: 'Save a webpage into the current library.' },
  { id: 'reveal-selected', label: 'Reveal selected item in Explorer', description: 'Reveal the selected item.' },
  {
    id: 'encrypt-current-note',
    label: 'Encrypt current note…',
    description: 'Protect the active note with a password.',
  },
  {
    id: 'convert-current-note',
    label: 'Convert current note to another format…',
    description: 'Create a Markdown or HTML copy of the active note.',
  },
  {
    id: 'convert-note-to-outline',
    label: 'Convert current note to outline…',
    description: 'Create an outline asset from the active Markdown note, keeping its heading structure.',
  },
  {
    id: 'insert-attachment',
    label: 'Insert image or attachment',
    description: 'Insert a labelled reference to a library attachment.',
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
    description: 'Choose a built-in or library template.',
    shortcut: 'Ctrl+Shift+N',
  },
  {
    id: 'annotate-selection',
    label: 'Annotate selection',
    description: 'Highlight selected reading text with a label and comment.',
    shortcut: 'Ctrl+Shift+A',
  },
  {
    id: 'annotate-pdf-selection',
    label: 'Annotate PDF selection',
    description: 'Add a note to selected PDF text.',
    contexts: ['pdf-selection', 'pdf-semantic'],
    requiresSelection: true,
  },
  {
    id: 'annotate-current-semantic-element',
    label: 'Annotate this paragraph/heading/cell',
    description: 'Add a note to the focused semantic element in PDF accessible text.',
    contexts: ['pdf-semantic'],
  },
  {
    id: 'show-reminders',
    label: 'Open Reminders',
    description: 'Show reminders and the grouped agenda.',
    shortcut: 'Ctrl+Shift+R',
  },
  {
    id: 'show-milestones',
    label: 'Open Milestones',
    description: 'Plan milestones with associated notes, tasks, and live progress.',
  },
  {
    id: 'show-assets',
    label: 'Cognitive tools',
    aliases: ['Cognitive Assets'],
    description: 'Edit outlines, mind maps, tables, and review flashcards.',
    shortcut: 'Ctrl+5',
    contexts: ['general'],
  },
  {
    id: 'format-bold',
    label: 'Bold',
    description: 'Format the editor selection as bold.',
    shortcut: 'Ctrl+B',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-italic',
    label: 'Italic',
    description: 'Format the editor selection as italic.',
    shortcut: 'Ctrl+I',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-heading1',
    label: 'Heading 1',
    description: 'Format selected lines as level-one headings.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-heading2',
    label: 'Heading 2',
    description: 'Format selected lines as level-two headings.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-heading3',
    label: 'Heading 3',
    description: 'Format selected lines as level-three headings.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-heading4',
    label: 'Heading 4',
    description: 'Format selected lines as level-four headings.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-heading5',
    label: 'Heading 5',
    description: 'Format selected lines as level-five headings.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-heading6',
    label: 'Heading 6',
    description: 'Format selected lines as level-six headings.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-bullet',
    label: 'Bulleted list',
    description: 'Format selected lines as a bullet list.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-numbered',
    label: 'Numbered list',
    description: 'Format selected lines as a numbered list.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-checkbox',
    label: 'Checkbox list',
    description: 'Format selected lines as checkbox tasks.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-quote',
    label: 'Quote',
    description: 'Format selected lines as a quote.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'format-code',
    label: 'Code block',
    description: 'Wrap selected text in a fenced code block.',
    contexts: ['editor-selection'],
    requiresSelection: true,
  },
  {
    id: 'insert-link',
    label: 'Insert link',
    description: 'Insert a web or wiki link with a labelled dialog.',
    shortcut: 'Ctrl+Shift+L',
    contexts: ['editor-selection'],
  },
  {
    id: 'insert-table',
    label: 'Insert table',
    description: 'Choose Markdown table rows and columns.',
    contexts: ['editor-selection'],
  },
  {
    id: 'open-vault',
    label: 'Open library',
    aliases: ['Open library'],
    description: 'Select and open a library from local storage.',
    shortcut: 'Ctrl+O',
    contexts: ['general'],
  },
  {
    id: 'new-notebook',
    label: 'New notebook',
    description: 'Create a new notebook entry within the current library.',
    contexts: ['general', 'tree-folder'],
  },
  {
    id: 'save-current-note',
    label: 'Save note',
    description: 'Save changes to the active Markdown note.',
    shortcut: 'Ctrl+S',
  },
  {
    id: 'edit-undo',
    label: 'Undo edit (recorded history)',
    description:
      'Undo the last edit in the active note from the recorded edit history. This is the guaranteed fallback when the editor’s native undo stack is unavailable (for example after tool edits); the Edit menu keeps the native Undo, and Ctrl+Z stays a reserved native editing key.',
  },
  {
    id: 'edit-redo',
    label: 'Redo edit (recorded history)',
    description:
      'Redo the last undone edit in the active note from the recorded edit history, when the editor’s native redo is unavailable.',
  },
  {
    id: 'show-tasks',
    label: 'Tasks',
    description: 'Show and manage note-associated tasks.',
    shortcut: 'Ctrl+4',
    contexts: ['general'],
  },
  {
    id: 'toggle-bookmark',
    label: 'Toggle note bookmark',
    description: 'Add or remove a bookmark for the active note.',
    shortcut: 'Ctrl+D',
  },
  {
    id: 'edit-note-metadata',
    label: 'Edit note metadata…',
    description:
      'View and edit the active note’s YAML front matter — title, tags, and other fields — with tag suggestions from the library.',
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
    shortcut: 'Alt+Q',
    contexts: ['general'],
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
    label: 'Command Palette',
    aliases: ['Open command search'],
    description: 'Open the command palette to run key commands.',
    shortcut: 'Ctrl+Shift+P',
    shortcutAliases: ['Ctrl+K'],
    contexts: ['general'],
  },
  {
    id: 'refresh-links',
    label: 'Refresh links',
    description: 'Rescan the library and rebuild local links and backlinks.',
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

export function getContextMenuCommands(context: MenuContext, hasSelection = false) {
  return COMMANDS.filter(
    (command) =>
      command.contexts?.includes(context) &&
      (!command.requiresSelection || hasSelection || context === 'editor-selection'),
  );
}

export function getKeyboardShortcuts(shortcuts: Partial<Record<CommandId, string>> = {}): KeyboardShortcutDefinition[] {
  return COMMANDS.flatMap((command) => {
    const shortcut = shortcuts[command.id] ?? command.shortcut;
    if (!shortcut) return [];
    return [
      { commandId: command.id, label: command.label, shortcut },
      ...(command.shortcutAliases ?? []).map((alias) => ({
        commandId: command.id,
        label: command.label,
        shortcut: alias,
      })),
    ];
  });
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
    case 'new-contextual':
      context.newContextual?.();
      return undefined;
    case 'new-library':
      context.newLibrary?.();
      return undefined;
    case 'new-note':
      context.newNote?.();
      return undefined;
    case 'new-task':
      context.newTask?.();
      return undefined;
    case 'new-asset':
      context.newAsset?.();
      return undefined;
    case 'navigate-back':
      context.navigateBack?.();
      return undefined;
    case 'navigate-forward':
      context.navigateForward?.();
      return undefined;
    case 'show-contents':
      if (context.showContents) {
        context.showContents();
      } else {
        context.setSelectedTab('contents');
      }
      return undefined;
    case 'show-libraries':
      if (context.showLibraries) {
        context.showLibraries();
      } else {
        context.setSelectedTab('libraries');
      }
      return undefined;
    case 'show-notebooks':
      if (context.showNotebooks) {
        context.showNotebooks();
      } else {
        context.setSelectedTab('notebooks');
      }
      return undefined;
    case 'show-notes-files':
      if (context.showNotesFiles) {
        context.showNotesFiles();
      } else {
        context.setSelectedTab('notes-files');
      }
      return undefined;
    case 'show-settings':
      context.showSettings?.();
      return undefined;
    case 'open-vault':
      if (context.openVault) {
        context.openVault();
        return undefined;
      }
      return 'Open library dialog ready.';
    case 'new-notebook':
      if (context.newNotebook) {
        context.newNotebook();
        return undefined;
      }
      return 'New notebook created in the current library.';
    case 'save-current-note':
      context.saveNote();
      return undefined;
    case 'show-tasks':
      context.showTasks();
      return undefined;
    case 'show-assets':
      if (context.showAssets) {
        context.showAssets();
      } else {
        context.setSelectedTab('assets');
      }
      return undefined;
    case 'export-current-note':
      if (context.exportCurrentNote) {
        context.exportCurrentNote();
        return undefined;
      }
      return 'Export current note dialog ready.';
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
      return 'Library and links refreshed.';
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
