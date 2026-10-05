// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PDF_READING_PREFERENCES, validatePdfReadingPreferences } from '../shared/pdf-reading-preferences';
import { EVENT_CHANNELS, IPC_CHANNELS, isInvokeChannel } from '../shared/ipc';
import type { NotebookBridge } from '../shared/bridge';

const mock = vi.hoisted(() => ({
  files: new Map<string, string>(),
  handlers: new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => Promise<unknown>>(),
  bridge: undefined as NotebookBridge | undefined,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  failWrite: false,
}));

vi.mock('node:fs', () => ({
  readFileSync: (file: string) => {
    if (!mock.files.has(file)) throw new Error('File not found.');
    return mock.files.get(file);
  },
  writeFileSync: (file: string, value: string) => {
    if (mock.failWrite) throw new Error('Disk full.');
    mock.files.set(file, value);
  },
  renameSync: (source: string, destination: string) => {
    mock.files.set(destination, mock.files.get(source)!);
    mock.files.delete(source);
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/preferences-test',
    isPackaged: true,
    requestSingleInstanceLock: () => false,
    quit: vi.fn(),
    on: vi.fn(),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, value?: unknown) => Promise<unknown>) =>
      mock.handlers.set(channel, handler),
  },
  ipcRenderer: { invoke: mock.invoke, on: mock.on, removeListener: mock.removeListener },
  contextBridge: {
    exposeInMainWorld: (_name: string, bridge: NotebookBridge) => {
      mock.bridge = bridge;
    },
  },
}));
vi.mock('../../electron/menu', () => ({ buildApplicationMenu: vi.fn() }));
vi.mock('../../electron/updater', () => ({ setupUpdater: vi.fn() }));
vi.mock('../../electron/vault/ipc', () => ({ setupVaultIpc: vi.fn() }));

import {
  fallbackStore,
  getPdfReadingPreferences,
  getStorePath,
  loadStore,
  saveStore,
  setPdfReadingPreferences,
} from '../../electron/store';
import { setupPdfReadingPreferencesIpc } from '../../electron/main';

beforeEach(() => {
  mock.files.clear();
  mock.handlers.clear();
  mock.failWrite = false;
  vi.clearAllMocks();
});

const enabled = { hideHeadersFooters: true, hidePageNumbers: true };
const invalidValues = [
  undefined,
  null,
  true,
  'preferences',
  [],
  {},
  { hideHeadersFooters: false },
  { hidePageNumbers: false },
  { hideHeadersFooters: 'true', hidePageNumbers: false },
  { hideHeadersFooters: false, hidePageNumbers: 1 },
  { ...enabled, extra: false },
  { ...enabled, [Symbol('extra')]: false },
  Object.create(enabled) as unknown,
];

describe('PDF reading preferences validation', () => {
  it('defaults both options to false and accepts only complete boolean records', () => {
    expect(DEFAULT_PDF_READING_PREFERENCES).toEqual({ hideHeadersFooters: false, hidePageNumbers: false });
    for (const hideHeadersFooters of [false, true]) {
      for (const hidePageNumbers of [false, true]) {
        const value = { hideHeadersFooters, hidePageNumbers };
        expect(validatePdfReadingPreferences(value)).toEqual(value);
        expect(validatePdfReadingPreferences(value)).not.toBe(value);
      }
    }
    for (const value of invalidValues) {
      expect(() => validatePdfReadingPreferences(value)).toThrow('Invalid PDF reading preferences.');
    }
  });
});

describe('PDF reading preferences local JSON persistence', () => {
  it('silently defaults missing files and legacy stores without changing notebook data', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(getPdfReadingPreferences()).toEqual(DEFAULT_PDF_READING_PREFERENCES);
      mock.files.set(getStorePath(), JSON.stringify({ vaults: [], notebooks: [] }));
      expect(loadStore()).toEqual({
        vaults: [],
        notebooks: [],
        pdfReadingPreferences: DEFAULT_PDF_READING_PREFERENCES,
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('logs malformed persisted preferences and falls back without discarding notebooks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const pdfReadingPreferences of invalidValues.filter((value) => value !== undefined)) {
        if (typeof pdfReadingPreferences === 'object' && pdfReadingPreferences !== null) {
          if (Reflect.ownKeys(pdfReadingPreferences).some((key) => typeof key === 'symbol')) continue;
        }
        mock.files.set(getStorePath(), JSON.stringify({ ...fallbackStore, pdfReadingPreferences }));
        expect(loadStore()).toEqual({ ...fallbackStore, pdfReadingPreferences: DEFAULT_PDF_READING_PREFERENCES });
      }
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('persists and reloads preferences across notebook saves and preserves notebook data across preference saves', () => {
    saveStore({ vaults: [], notebooks: [] });
    expect(setPdfReadingPreferences(enabled)).toEqual(enabled);
    expect(loadStore()).toEqual({ vaults: [], notebooks: [], pdfReadingPreferences: enabled });
    expect(JSON.parse(mock.files.get(getStorePath())!)).toEqual(loadStore());
    saveStore({ vaults: fallbackStore.vaults, notebooks: fallbackStore.notebooks });
    expect(getPdfReadingPreferences()).toEqual(enabled);
    expect(loadStore().notebooks).toEqual(fallbackStore.notebooks);
    expect(setPdfReadingPreferences(DEFAULT_PDF_READING_PREFERENCES)).toEqual(DEFAULT_PDF_READING_PREFERENCES);
    expect(loadStore().notebooks).toEqual(fallbackStore.notebooks);
    expect(mock.files.has(`${getStorePath()}.tmp`)).toBe(false);
  });

  it('rejects invalid writes and does not mutate preferences after read or persistence failure', () => {
    setPdfReadingPreferences(enabled);
    const current = getPdfReadingPreferences();
    current.hidePageNumbers = false;
    expect(getPdfReadingPreferences()).toEqual(enabled);
    for (const value of invalidValues) expect(() => setPdfReadingPreferences(value)).toThrow();
    expect(() => saveStore({ ...loadStore(), pdfReadingPreferences: { ...enabled, extra: true } as never })).toThrow();
    mock.failWrite = true;
    expect(() => setPdfReadingPreferences(DEFAULT_PDF_READING_PREFERENCES)).toThrow('Disk full.');
    expect(getPdfReadingPreferences()).toEqual(enabled);
  });

  it('does not expose shared mutable fallback preferences', () => {
    loadStore().pdfReadingPreferences.hidePageNumbers = true;
    expect(getPdfReadingPreferences()).toEqual(DEFAULT_PDF_READING_PREFERENCES);
  });
});

describe('PDF reading preferences typed IPC', () => {
  const trusted = {} as IpcMainInvokeEvent;

  it('whitelists only invoke channels and returns, persists, and broadcasts validated changes', async () => {
    const send = vi.fn();
    setupPdfReadingPreferencesIpc((event) => event === trusted, send);
    expect(isInvokeChannel(IPC_CHANNELS.getPdfReadingPreferences)).toBe(true);
    expect(isInvokeChannel(IPC_CHANNELS.setPdfReadingPreferences)).toBe(true);
    expect(isInvokeChannel(IPC_CHANNELS.pdfReadingPreferencesChanged)).toBe(false);
    expect(EVENT_CHANNELS).toContain(IPC_CHANNELS.pdfReadingPreferencesChanged);
    const get = mock.handlers.get(IPC_CHANNELS.getPdfReadingPreferences)!;
    const set = mock.handlers.get(IPC_CHANNELS.setPdfReadingPreferences)!;
    await expect(get(trusted)).resolves.toEqual(DEFAULT_PDF_READING_PREFERENCES);
    await expect(set(trusted, enabled)).resolves.toEqual(enabled);
    await expect(get(trusted)).resolves.toEqual(enabled);
    expect(send).toHaveBeenCalledExactlyOnceWith(enabled);
    for (const value of invalidValues) await expect(set(trusted, value)).rejects.toThrow();
    await expect(get({} as IpcMainInvokeEvent)).rejects.toThrow('Untrusted');
    await expect(set({} as IpcMainInvokeEvent, enabled)).rejects.toThrow('Untrusted');
    mock.failWrite = true;
    await expect(set(trusted, DEFAULT_PDF_READING_PREFERENCES)).rejects.toThrow('Disk full.');
    expect(send).toHaveBeenCalledTimes(1);
    expect(getPdfReadingPreferences()).toEqual(enabled);
  });

  it('exposes fixed preload methods and removes event listeners without exposing Electron events', async () => {
    await import('../../electron/preload');
    mock.invoke.mockResolvedValue(enabled);
    await expect(mock.bridge!.getPdfReadingPreferences!()).resolves.toEqual(enabled);
    expect(mock.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.getPdfReadingPreferences);
    await expect(mock.bridge!.setPdfReadingPreferences!(enabled)).resolves.toEqual(enabled);
    expect(mock.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.setPdfReadingPreferences, enabled);
    const callback = vi.fn();
    const unsubscribe = mock.bridge!.onPdfReadingPreferencesChanged!(callback);
    const [channel, listener] = mock.on.mock.calls[0] as [string, (event: unknown, value: unknown) => void];
    expect(channel).toBe(IPC_CHANNELS.pdfReadingPreferencesChanged);
    listener({ sender: 'must not reach renderer' }, enabled);
    expect(callback).toHaveBeenCalledExactlyOnceWith(enabled);
    unsubscribe();
    expect(mock.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener);
  });
});
