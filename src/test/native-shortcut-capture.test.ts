// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent, MenuItemConstructorOptions } from 'electron';
import type { NotebookBridge } from '../shared/bridge';
import { IPC_CHANNELS } from '../shared/ipc';
import { getCommandById } from '../shared/command-registry';

const mock = vi.hoisted(() => {
  const contentsEvents = new Map<string, () => void>();
  const windowEvents = new Map<string, () => void>();
  const mainFrame = { url: '' };
  const webContents = {
    mainFrame,
    isDestroyed: vi.fn(() => false),
    setIgnoreMenuShortcuts: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((name: string, callback: () => void) => contentsEvents.set(name, callback)),
  };
  const window = {
    webContents,
    once: vi.fn(),
    on: vi.fn((name: string, callback: () => void) => windowEvents.set(name, callback)),
    loadFile: vi.fn(async (filename: string) => {
      mainFrame.url = new URL(`file://${filename}`).href;
    }),
    isDestroyed: vi.fn(() => false),
  };
  return {
    contentsEvents,
    windowEvents,
    window,
    webContents,
    listeners: new Map<string, (event: IpcMainEvent, value: unknown) => void>(),
    template: [] as MenuItemConstructorOptions[],
    bridge: undefined as NotebookBridge | undefined,
    send: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
  },
  BrowserWindow: Object.assign(
    vi.fn(function () {
      return mock.window;
    }),
    { getAllWindows: () => [mock.window] },
  ),
  Menu: {
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => {
      mock.template = template;
      return { items: template };
    }),
    setApplicationMenu: vi.fn(),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
  ipcMain: {
    handle: vi.fn(),
    on: (channel: string, listener: (event: IpcMainEvent, value: unknown) => void) =>
      mock.listeners.set(channel, listener),
  },
  ipcRenderer: { send: mock.send },
  contextBridge: {
    exposeInMainWorld: (_name: string, bridge: NotebookBridge) => {
      mock.bridge = bridge;
    },
  },
}));
vi.mock('../../electron/updater', () => ({ setupUpdater: vi.fn() }));
vi.mock('../../electron/vault/ipc', () => ({ setupVaultIpc: vi.fn() }));
vi.mock('../../electron/store', () => ({
  getPdfReadingPreferences: vi.fn(),
  setPdfReadingPreferences: vi.fn(),
}));

import '../../electron/main';
import '../../electron/preload';

function trustedEvent() {
  return {
    sender: mock.webContents,
    senderFrame: mock.webContents.mainFrame,
  } as unknown as IpcMainEvent;
}

function capture(value: unknown, event = trustedEvent()) {
  mock.listeners.get(IPC_CHANNELS.shortcutCaptureActive)!(event, value);
}

function menuItem(label: string) {
  return mock.template
    .flatMap((group) => group.submenu as MenuItemConstructorOptions[])
    .find((item) => item.label === label)!;
}

beforeEach(() => {
  capture(false);
  vi.clearAllMocks();
});

describe('native shortcut capture suppression', () => {
  it('retains native access to commands whose duplicate renderer strips can be hidden', () => {
    for (const id of [
      'command-search',
      'show-settings',
      'toggle-read-only-mode',
      'save-current-note',
      'export-current-note',
      'toggle-bookmark',
      'close-current-tab',
      'refresh-links',
      'format-heading6',
    ] as const) {
      expect(menuItem(getCommandById(id)!.label)).toBeDefined();
    }
  });

  it('exposes only a typed boolean capture signal, never a raw IPC channel API', () => {
    mock.bridge!.setShortcutCaptureActive!(true);
    mock.bridge!.setShortcutCaptureActive!(false);
    mock.bridge!.setShortcutCaptureActive!('true' as unknown as boolean);
    expect(mock.send.mock.calls).toEqual([
      [IPC_CHANNELS.shortcutCaptureActive, true],
      [IPC_CHANNELS.shortcutCaptureActive, false],
    ]);
    expect(mock.bridge).not.toHaveProperty('send');
  });

  it('disables native role accelerators and command dispatch during capture, then restores both', () => {
    const oldCommand = menuItem('New library').click as () => void;
    capture(true);
    expect(mock.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    for (const group of mock.template) {
      for (const item of group.submenu as MenuItemConstructorOptions[]) {
        if (item.type !== 'separator') expect(item.enabled).toBe(false);
      }
    }
    oldCommand();
    (menuItem('Check for &Updates…').click as () => void)();
    expect(mock.webContents.send).not.toHaveBeenCalled();

    capture(false);
    expect(mock.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    expect(menuItem('New library').enabled).not.toBe(false);
    oldCommand();
    expect(mock.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.menuCommand, 'new-library');
  });

  it('ignores untrusted frames and non-boolean payloads', () => {
    capture(true, { ...trustedEvent(), senderFrame: null } as unknown as IpcMainEvent);
    capture(true, { ...trustedEvent(), sender: {} } as IpcMainEvent);
    capture(true, {
      ...trustedEvent(),
      senderFrame: { url: 'https://untrusted.example/' },
    } as IpcMainEvent);
    for (const value of [undefined, null, 1, 'true', {}, []]) capture(value);
    expect(mock.webContents.setIgnoreMenuShortcuts).not.toHaveBeenCalled();
    (menuItem('New library').click as () => void)();
    expect(mock.webContents.send).toHaveBeenCalledOnce();
  });

  it.each(['did-start-loading', 'render-process-gone'])('restores shortcuts after %s', (event) => {
    capture(true);
    mock.contentsEvents.get(event)!();
    expect(mock.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    expect(menuItem('New library').enabled).not.toBe(false);
  });

  it.each(['window', 'webContents'] as const)('resets capture without touching destroyed %s', (target) => {
    capture(true);
    mock[target].isDestroyed.mockReturnValueOnce(true);
    mock.webContents.setIgnoreMenuShortcuts.mockClear();
    expect(() => mock.contentsEvents.get('render-process-gone')!()).not.toThrow();
    expect(mock.webContents.setIgnoreMenuShortcuts).not.toHaveBeenCalled();
    expect(menuItem('New library').enabled).not.toBe(false);
  });
});
