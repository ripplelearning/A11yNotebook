// Native Windows application menu. Help items forward a whitelisted command to the
// renderer so native and in-app menus share one implementation.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/shared/ipc';
import { getCommandById, type CommandId } from '../src/shared/command-registry';

export function buildApplicationMenu(
  sendCommand: (command: MenuCommand) => void,
  isDevelopment: boolean,
  isShortcutCaptureActive: () => boolean = () => false,
) {
  const dispatch = (command: MenuCommand) => {
    if (!isShortcutCaptureActive()) sendCommand(command);
  };
  const commandItem = (id: CommandId): MenuItemConstructorOptions => ({
    label: getCommandById(id)!.label,
    click: () => dispatch(id),
  });
  const viewItems: MenuItemConstructorOptions[] = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];
  if (isDevelopment) {
    viewItems.push({ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' });
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        commandItem('new-contextual'),
        commandItem('new-library'),
        commandItem('open-vault'),
        commandItem('new-notebook'),
        commandItem('new-note'),
        commandItem('new-from-template'),
        commandItem('import-file'),
        commandItem('open-selected-external'),
        commandItem('save-current-note'),
        commandItem('export-current-note'),
        commandItem('toggle-bookmark'),
        commandItem('close-current-tab'),
        commandItem('refresh-links'),
        { type: 'separator' },
        { role: 'quit', label: 'E&xit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'F&ormat',
      submenu: [
        commandItem('format-bold'),
        commandItem('format-italic'),
        commandItem('format-heading1'),
        commandItem('format-heading2'),
        commandItem('format-heading3'),
        commandItem('format-heading4'),
        commandItem('format-heading5'),
        commandItem('format-heading6'),
        commandItem('format-bullet'),
        commandItem('format-numbered'),
        commandItem('format-checkbox'),
        commandItem('format-quote'),
        commandItem('format-code'),
        commandItem('insert-link'),
        commandItem('insert-table'),
        commandItem('insert-attachment'),
        commandItem('annotate-selection'),
      ],
    },
    {
      label: '&Tools',
      submenu: [
        commandItem('new-task'),
        commandItem('new-asset'),
        commandItem('show-reminders'),
        commandItem('show-milestones'),
        commandItem('show-assets'),
        commandItem('show-settings'),
      ],
    },
    {
      label: '&View',
      submenu: [
        commandItem('show-contents'),
        commandItem('show-libraries'),
        commandItem('show-notebooks'),
        commandItem('show-notes-files'),
        commandItem('show-tasks'),
        commandItem('show-assets'),
        { type: 'separator' },
        commandItem('toggle-right-pane'),
        commandItem('toggle-read-only-mode'),
        { type: 'separator' },
        ...viewItems,
      ],
    },
    {
      label: '&Window',
      submenu: [
        commandItem('focus-search'),
        commandItem('focus-navigation'),
        commandItem('focus-main-content'),
        commandItem('focus-right-pane'),
      ],
    },
    {
      label: '&Help',
      submenu: [
        commandItem('command-search'),
        { label: 'Check for &Updates…', click: () => dispatch('check-for-updates') },
        { label: '&Keyboard Shortcuts', click: () => dispatch('show-keyboard-shortcuts') },
        { type: 'separator' },
        { label: '&About A11y Notebook', click: () => dispatch('show-about') },
      ],
    },
  ];

  if (isShortcutCaptureActive()) {
    for (const group of template) {
      for (const item of group.submenu as MenuItemConstructorOptions[]) {
        if (item.type !== 'separator') item.enabled = false;
      }
    }
  }
  return Menu.buildFromTemplate(template);
}
