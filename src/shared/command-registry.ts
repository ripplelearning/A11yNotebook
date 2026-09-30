export type CommandId =
  | 'open-vault'
  | 'new-notebook'
  | 'close-current-tab'
  | 'toggle-read-only-mode'
  | 'toggle-right-pane'
  | 'focus-search'
  | 'focus-navigation'
  | 'focus-main-content'
  | 'focus-right-pane'
  | 'command-search'
  | 'refresh-links'
  | 'show-keyboard-shortcuts';

export type FocusRegion = 'navigation' | 'main' | 'tabs' | 'right-pane' | 'status';

type CommandActionContext = {
  mode: 'read-only' | 'edit';
  rightPaneOpen: boolean;
  setMode: (value: 'read-only' | 'edit') => void;
  setRightPaneOpen: (value: boolean) => void;
  setStatusMessage: (value: string) => void;
  setCommandPaletteOpen: (value: boolean) => void;
  setSelectedTab: (value: string) => void;
};

export type CommandDefinition = {
  id: CommandId;
  label: string;
  description: string;
  shortcut?: string;
};

export const COMMANDS: CommandDefinition[] = [
  { id: 'open-vault', label: 'Open vault', description: 'Select and open a vault from local storage.', shortcut: 'Ctrl+O' },
  { id: 'new-notebook', label: 'New notebook', description: 'Create a new notebook entry within the current vault.', shortcut: 'Ctrl+N' },
  { id: 'close-current-tab', label: 'Close current tab', description: 'Close the active tab.', shortcut: 'Ctrl+W' },
  { id: 'toggle-read-only-mode', label: 'Toggle read-only/edit mode', description: 'Switch between read-only and edit mode.', shortcut: 'Ctrl+E' },
  { id: 'toggle-right-pane', label: 'Toggle right pane', description: 'Show or hide the right information pane.', shortcut: 'F9' },
  { id: 'focus-search', label: 'Focus search', description: 'Move focus to the global search box.', shortcut: 'Ctrl+L' },
  { id: 'focus-navigation', label: 'Focus navigation', description: 'Move focus to the navigation pane.', shortcut: 'Alt+1' },
  { id: 'focus-main-content', label: 'Focus main content', description: 'Move focus to the content pane.', shortcut: 'Alt+2' },
  { id: 'focus-right-pane', label: 'Focus right pane', description: 'Move focus to the right pane.', shortcut: 'Alt+3' },
  { id: 'command-search', label: 'Open command search', description: 'Open the command palette to run key commands.', shortcut: 'Ctrl+K' },
  { id: 'refresh-links', label: 'Refresh links', description: 'Refresh local links and relationships in the vault.', shortcut: 'F5' },
  { id: 'show-keyboard-shortcuts', label: 'Show keyboard shortcuts', description: 'Display keyboard shortcuts and navigation help.', shortcut: 'F1' },
];

export function getCommandById(commandId: CommandId) {
  return COMMANDS.find((command) => command.id === commandId);
}

export function cycleFocusRegions(current: FocusRegion, direction: 'forward' | 'backward' = 'forward') {
  const order: FocusRegion[] = ['navigation', 'main', 'tabs', 'right-pane', 'status'];
  const index = order.indexOf(current);
  const nextIndex = direction === 'forward' ? (index + 1) % order.length : (index - 1 + order.length) % order.length;
  return order[nextIndex];
}

export function dispatchCommand(commandId: CommandId, context: CommandActionContext) {
  switch (commandId) {
    case 'open-vault':
      return 'Open vault dialog ready.';
    case 'new-notebook':
      return 'New notebook created in the current vault.';
    case 'close-current-tab':
      context.setSelectedTab('welcome');
      return 'Current tab closed.';
    case 'toggle-read-only-mode': {
      const nextMode = context.mode === 'read-only' ? 'edit' : 'read-only';
      context.setMode(nextMode);
      return `Mode switched to ${nextMode}.`;
    }
    case 'toggle-right-pane': {
      const nextState = !context.rightPaneOpen;
      context.setRightPaneOpen(nextState);
      return nextState ? 'Right pane opened.' : 'Right pane closed.';
    }
    case 'focus-search':
      return 'Focus set to global search.';
    case 'focus-navigation':
      return 'Focus set to navigation.';
    case 'focus-main-content':
      return 'Focus set to main content.';
    case 'focus-right-pane':
      return 'Focus set to right pane.';
    case 'command-search':
      context.setCommandPaletteOpen(true);
      return 'Command palette opened.';
    case 'refresh-links':
      return 'Local links refreshed.';
    case 'show-keyboard-shortcuts':
      return 'Keyboard shortcuts help shown.';
    default:
      return 'Command not recognized.';
  }
}
