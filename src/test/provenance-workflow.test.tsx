import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

const library: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [
        { name: 'Managed.md', path: 'Research/Managed.md', kind: 'note', provenance: 'app-created' },
        { name: 'Imported.md', path: 'Research/Imported.md', kind: 'note', provenance: 'imported' },
        { name: 'Outside.md', path: 'Research/Outside.md', kind: 'note', provenance: 'unknown' },
      ],
    },
  ],
};

function installBridge() {
  const bridge: NotebookBridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    onMenuCommand: vi.fn(() => () => undefined),
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => library),
      get: vi.fn(async () => library),
      readNote: vi.fn(async () => '# Inside'),
      saveNote: vi.fn(),
      createNotebook: vi.fn(async () => library),
      createNote: vi.fn(async () => library),
      rename: vi.fn(async () => library),
      delete: vi.fn(async () => library),
      reveal: vi.fn(),
      openExternal: vi.fn(),
      openUrl: vi.fn(),
      importFile: vi.fn(async () => library),
      getTasks: vi.fn(async () => []),
      toggleTask: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      toggleBookmark: vi.fn(async () => []),
    },
  };
  window.a11yNotebook = bridge;
  return bridge;
}

async function showFiles() {
  await screen.findByRole('heading', { name: 'Study' });
  fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
  fireEvent.keyDown(document.body, { ctrlKey: true, key: '3' });
  return screen.findByRole('grid', { name: 'Notes and files' });
}

afterEach(() => {
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

describe('provenance-aware row activation', () => {
  it.each(['Managed.md', 'Imported.md'])('opens %s internally without a chooser', async (name) => {
    const bridge = installBridge();
    render(<App />);
    const grid = await showFiles();
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name }), { key: 'Enter' });
    await screen.findByRole('heading', { name: name.replace('.md', ''), level: 2 });
    expect(bridge.vault.readNote).toHaveBeenCalledWith(`Research/${name}`, undefined);
    expect(screen.queryByRole('dialog', { name: 'Open external file' })).not.toBeInTheDocument();
    expect(bridge.vault.openExternal).not.toHaveBeenCalled();
  });

  it('does not classify an unknown Markdown file as managed just because of its extension or folder', async () => {
    const bridge = installBridge();
    render(<App />);
    const grid = await showFiles();
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Outside.md' }), { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Open external file' });
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 75)));
    expect(within(screen.getByLabelText('Status bar')).getByRole('status')).not.toHaveTextContent(
      'Notes and Files in Research',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open with…' }));
    await waitFor(() => expect(bridge.vault.openWith).toHaveBeenCalledWith('Research/Outside.md'));
    expect(bridge.vault.openExternal).not.toHaveBeenCalled();
  });

  it('imports a separate copy and opens the returned destination, leaving the original unopened', async () => {
    const bridge = installBridge();
    const copy = {
      name: 'Outside imported.md',
      path: 'Research/Outside imported.md',
      kind: 'note' as const,
      provenance: 'imported' as const,
    };
    const importedLibrary = {
      ...library,
      entries: [{ ...library.entries[0], children: [...library.entries[0].children!, copy] }],
    };
    vi.mocked(bridge.vault.importEntry!).mockResolvedValue({ vault: importedLibrary, path: copy.path });
    render(<App />);
    const grid = await showFiles();
    const row = within(grid).getByRole('gridcell', { name: 'Outside.md' });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Import into A11y Notebook' }));
    await screen.findByRole('heading', { name: 'Outside imported', level: 2 });
    expect(bridge.vault.importEntry).toHaveBeenCalledWith('Research/Outside.md');
    expect(bridge.vault.readNote).toHaveBeenCalledWith(copy.path, undefined);
    expect(bridge.vault.readNote).not.toHaveBeenCalledWith('Research/Outside.md', undefined);
  });

  it('does not reopen imported content if the library locks while import is pending', async () => {
    const bridge = installBridge();
    let lock!: () => void;
    bridge.vault.onSecurityLocked = (callback) => {
      lock = callback;
      return () => undefined;
    };
    let finish!: (value: Awaited<ReturnType<NonNullable<typeof bridge.vault.importEntry>>>) => void;
    vi.mocked(bridge.vault.importEntry!).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<App />);
    const grid = await showFiles();
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Outside.md' }), { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Open external file' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import into A11y Notebook' }));
    await act(async () => lock());
    await act(async () => finish({ vault: library, path: 'Research/Imported.md' }));
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Open external file' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Library locked.');
  });
});
