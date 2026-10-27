import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultChangedEvent } from '../shared/search';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

describe('task-links watcher refresh', () => {
  it('reloads task links when the task-links store changes externally, and ignores other changes', async () => {
    const vault: VaultInfo = {
      name: 'Study library',
      path: '/study',
      entries: [{ name: 'Idea.md', path: 'Idea.md', kind: 'note', provenance: 'created' }],
    };
    const changedListeners: Array<(event: VaultChangedEvent) => void> = [];
    const getTaskLinks = vi.fn(async () => []);
    const bridge = {
      updater: {
        check: vi.fn(),
        download: vi.fn(),
        installNow: vi.fn(),
        installOnExit: vi.fn(),
        onStatus: vi.fn(() => () => undefined),
      },
      setShortcutCaptureActive: vi.fn(),
      onMenuCommand: vi.fn(() => () => undefined),
      vault: {
        ...vaultExtensions(),
        onChanged: (callback: (event: VaultChangedEvent) => void) => {
          changedListeners.push(callback);
          return () => undefined;
        },
        get: vi.fn(async () => vault),
        getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
        readNote: vi.fn(async () => '# Idea'),
        saveNote: vi.fn(async () => undefined),
        importFile: vi.fn(async (): Promise<VaultInfo | null> => null),
        openExternal: vi.fn(async () => undefined),
        getTasks: vi.fn(async () => []),
        getTaskLinks,
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
      },
    };
    window.a11yNotebook = bridge as unknown as NotebookBridge;
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    await waitFor(() => expect(getTaskLinks).toHaveBeenCalled());
    const initialCalls = getTaskLinks.mock.calls.length;

    act(() => {
      for (const listener of changedListeners)
        listener({ vaultPath: '/study', paths: ['.a11ynotebook/task-links.json'] });
    });
    await waitFor(() => expect(getTaskLinks).toHaveBeenCalledTimes(initialCalls + 1));

    const afterRefresh = getTaskLinks.mock.calls.length;
    act(() => {
      for (const listener of changedListeners) listener({ vaultPath: '/study', paths: ['Idea.md'] });
    });
    act(() => {
      for (const listener of changedListeners)
        listener({ vaultPath: '/elsewhere', paths: ['.a11ynotebook/task-links.json'] });
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getTaskLinks).toHaveBeenCalledTimes(afterRefresh);
  });
});
