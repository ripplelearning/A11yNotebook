import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItemConstructorOptions } from 'electron';
import { buildApplicationMenu, updateApplicationMenu } from '../../electron/menu';
import { getCommandById, type CommandId } from '../shared/command-registry';
import { isNativeMenuState, type NativeMenuState } from '../shared/ipc';

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

const menuTemplate = () => vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
const submenuFor = (group: string) =>
  menuTemplate().find((item) => item.label === group)?.submenu as MenuItemConstructorOptions[];
const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);

describe('native command menu', () => {
  it.each([
    ['&File', 'new-contextual'],
    ['&File', 'new-library'],
    ['&File', 'new-notebook'],
    ['&File', 'new-note'],
    ['&Tools', 'import-file'],
    ['&Tools', 'open-selected-external'],
    ['&Insert', 'insert-link'],
    ['F&ormat', 'format-heading6'],
    ['&Tools', 'new-task'],
    ['&Tools', 'new-asset'],
    ['&View', 'toggle-read-only-mode'],
    ['&Window', 'focus-search'],
    ['&Window', 'focus-navigation'],
    ['&Window', 'focus-main-content'],
    ['&Window', 'focus-right-pane'],
    ['&Help', 'show-keyboard-shortcuts'],
  ] as const)('dispatches %s / %s with its registry label exactly once', (group, id: CommandId) => {
    const sendCommand = vi.fn();
    buildApplicationMenu(sendCommand, false);
    const item = submenuFor(group).find((candidate) => candidate.id === id);
    expect(item?.label).toBe(getCommandById(id)!.label);
    expect(item?.accelerator).toBeUndefined();
    (item!.click as () => void)();
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('groups all shell commands in Windows-mnemonic menus without duplicate IDs or accelerators', () => {
    const sendCommand = vi.fn();
    buildApplicationMenu(sendCommand, false);
    const template = menuTemplate();
    expect(template.map((item) => item.label)).toEqual([
      // On macOS the template starts with the role-only app menu, whose
      // label is undefined until Electron fills in the app name.
      ...(process.platform === 'darwin' ? [undefined] : []),
      '&File',
      '&Edit',
      '&View',
      '&Insert',
      'F&ormat',
      '&Tools',
      '&Window',
      '&Help',
    ]);

    const commands = flatten(template.flatMap((item) => (Array.isArray(item.submenu) ? item.submenu : []))).filter(
      (item) => item.id,
    );
    const ids = commands.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'export-current-note',
      'close-current-tab',
      'toggle-read-only-mode',
      'toggle-bookmark',
      'command-search',
      'focus-search',
      'refresh-links',
      'capture-webpage',
      'import-file',
      'reveal-selected',
      'open-selected-external',
      'encrypt-current-note',
      'convert-current-note',
      'format-heading4',
      'format-heading5',
      'format-heading6',
    ]) {
      expect(ids).toContain(id);
    }
    expect(commands.every((item) => item.accelerator === undefined && item.enabled === false)).toBe(true);
    expect(submenuFor('&Edit').some((item) => item.role === 'undo')).toBe(true);
    expect(submenuFor('&File').some((item) => item.type === 'separator')).toBe(true);
  });

  it('applies only typed enabled and checkbox state to native menu items', () => {
    const items = new Map([
      ['toggle-right-pane', { enabled: false, checked: false, type: 'checkbox' }],
      ['save-current-note', { enabled: false, checked: false, type: 'normal' }],
    ]);
    const menu = { getMenuItemById: (id: string) => items.get(id) } as unknown as Menu;
    const state: NativeMenuState = {
      enabled: { 'toggle-right-pane': true, 'save-current-note': false },
      checked: { 'toggle-right-pane': true, 'save-current-note': true },
    };

    expect(isNativeMenuState(state)).toBe(true);
    updateApplicationMenu(menu, state);
    expect(items.get('toggle-right-pane')).toEqual({ enabled: true, checked: true, type: 'checkbox' });
    expect(items.get('save-current-note')).toEqual({ enabled: false, checked: false, type: 'normal' });
    expect(isNativeMenuState({ enabled: { arbitrary: true }, checked: {} })).toBe(false);
    expect(isNativeMenuState({ enabled: { 'save-current-note': 'yes' }, checked: {} })).toBe(false);
    expect(isNativeMenuState({ enabled: {}, checked: {}, template: [] })).toBe(false);
  });
});
