// Native Windows application menu. Renderer commands remain registry-backed and
// are forwarded through the fixed menu-command IPC channel.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand, NativeMenuState } from '../src/shared/ipc';
import { getCommandById, type CommandId } from '../src/shared/command-registry';

export function buildApplicationMenu(
  sendCommand: (command: MenuCommand) => void,
  isDevelopment: boolean,
  isShortcutCaptureActive: () => boolean = () => false,
) {
  const dispatch = (command: MenuCommand) => {
    if (!isShortcutCaptureActive()) sendCommand(command);
  };
  const commandItem = (id: CommandId, type?: 'checkbox'): MenuItemConstructorOptions => ({
    id,
    label: getCommandById(id)!.label,
    enabled: false,
    ...(type ? { type } : {}),
    click: () => dispatch(id),
  });
  const viewItems: MenuItemConstructorOptions[] = [
    commandItem('show-contents'),
    commandItem('show-libraries'),
    commandItem('show-notebooks'),
    commandItem('show-notes-files'),
    commandItem('show-tasks'),
    commandItem('show-assets'),
    commandItem('show-reminders'),
    commandItem('show-milestones'),
    { type: 'separator' },
    commandItem('toggle-right-pane', 'checkbox'),
    commandItem('toggle-read-only-mode', 'checkbox'),
    { type: 'separator' },
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
        commandItem('new-library'),
        commandItem('backup-library'),
        { type: 'separator' },
        commandItem('new-contextual'),
        commandItem('new-notebook'),
        commandItem('new-note'),
        commandItem('new-from-template'),
        { type: 'separator' },
        commandItem('save-current-note'),
        commandItem('export-current-note'),
        commandItem('close-current-tab'),
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
      label: '&View',
      submenu: viewItems,
    },
    {
      label: '&Insert',
      submenu: [
        commandItem('insert-link'),
        commandItem('insert-table'),
        commandItem('insert-math'),
        commandItem('insert-attachment'),
        commandItem('open-citation-generator'),
        commandItem('open-bibliography'),
        commandItem('annotate-selection'),
      ],
    },
    {
      label: 'F&ormat',
      submenu: [
        commandItem('format-bold'),
        commandItem('format-italic'),
        { type: 'separator' },
        commandItem('format-heading1'),
        commandItem('format-heading2'),
        commandItem('format-heading3'),
        commandItem('format-heading4'),
        commandItem('format-heading5'),
        commandItem('format-heading6'),
        { type: 'separator' },
        commandItem('format-bullet'),
        commandItem('format-numbered'),
        commandItem('format-checkbox'),
        commandItem('format-quote'),
        commandItem('format-code'),
      ],
    },
    {
      label: '&Tools',
      submenu: [
        commandItem('new-task'),
        commandItem('new-asset'),
        commandItem('capture-webpage'),
        commandItem('import-file'),
        commandItem('reveal-selected'),
        commandItem('open-selected-external'),
        { type: 'separator' },
        commandItem('toggle-bookmark', 'checkbox'),
        commandItem('encrypt-current-note'),
        commandItem('convert-current-note'),
        commandItem('convert-note-to-outline'),
        { type: 'separator' },
        commandItem('refresh-links'),
        { type: 'separator' },
        commandItem('check-spelling-grammar'),
        commandItem('open-thesaurus'),
        { type: 'separator' },
        commandItem('show-settings'),
        commandItem('command-search'),
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
        // Explicit U mnemonic, so Alt+H then U checks for updates. The
        // registry label stays plain so in-app surfaces are unaffected.
        { ...commandItem('check-for-updates'), label: 'Check for &Updates' },
        commandItem('show-keyboard-shortcuts'),
        { type: 'separator' },
        commandItem('show-about'),
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

export function updateApplicationMenu(menu: Menu, state: NativeMenuState) {
  for (const [id, enabled] of Object.entries(state.enabled)) {
    const item = menu.getMenuItemById(id);
    if (item) item.enabled = enabled;
  }
  for (const [id, checked] of Object.entries(state.checked)) {
    const item = menu.getMenuItemById(id);
    if (item?.type === 'checkbox') item.checked = checked;
  }
}
