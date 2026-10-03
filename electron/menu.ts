// Native Windows application menu. Help items forward a whitelisted command to the
// renderer so native and in-app menus share one implementation.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/shared/ipc';
import { getCommandById, type CommandId } from '../src/shared/command-registry';

export function buildApplicationMenu(sendCommand: (command: MenuCommand) => void, isDevelopment: boolean) {
  const commandItem = (id: CommandId): MenuItemConstructorOptions => ({
    label: getCommandById(id)!.label,
    click: () => sendCommand(id),
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
        commandItem('open-vault'),
        commandItem('new-notebook'),
        commandItem('new-from-template'),
        commandItem('save-current-note'),
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
      submenu: [commandItem('show-reminders'), commandItem('show-assets'), commandItem('show-settings')],
    },
    { label: '&View', submenu: viewItems },
    {
      label: '&Help',
      submenu: [
        { label: 'Check for &Updates…', click: () => sendCommand('check-for-updates') },
        { label: '&Keyboard Shortcuts', click: () => sendCommand('show-keyboard-shortcuts') },
        { type: 'separator' },
        { label: '&About A11y Notebook', click: () => sendCommand('show-about') },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
