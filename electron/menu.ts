// Native Windows application menu. Help items forward a whitelisted command to the
// renderer so native and in-app menus share one implementation.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/shared/ipc';

export function buildApplicationMenu(sendCommand: (command: MenuCommand) => void, isDevelopment: boolean) {
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
    { label: '&File', submenu: [{ role: 'quit', label: 'E&xit' }] },
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
