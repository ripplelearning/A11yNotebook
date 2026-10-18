import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItemConstructorOptions } from 'electron';
import { buildApplicationMenu } from '../../electron/menu';
import { getCommandById, type CommandId } from '../shared/command-registry';

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe('native command menu', () => {
  it.each([
    ['&File', 'new-contextual'],
    ['&File', 'new-library'],
    ['&File', 'new-notebook'],
    ['&File', 'new-note'],
    ['&File', 'import-file'],
    ['&File', 'open-selected-external'],
    ['&Tools', 'new-task'],
    ['&Tools', 'new-asset'],
  ] as const)('dispatches %s / %s with its registry label and unchanged semantics', (group, id: CommandId) => {
    const sendCommand = vi.fn();
    buildApplicationMenu(sendCommand, false);
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
    const submenu = template.find((item) => item.label === group)?.submenu as MenuItemConstructorOptions[];
    const items = submenu.filter((candidate) => candidate.label === getCommandById(id)!.label);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.accelerator).toBeUndefined();
    (item!.click as () => void)();
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith(id);
  });
});
