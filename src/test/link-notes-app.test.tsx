import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { PointerImport, VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';
import { gridNameCell } from './library-navigation';

const LINK_URL = 'https://example.com/guide';
const LINK_FILE_TEXT = `[InternetShortcut]\r\nURL=${LINK_URL}\r\n`;

function installBridge() {
  let listener: ((command: MenuCommand) => void) | undefined;
  const vault: VaultInfo = {
    name: 'Study library',
    path: '/study',
    entries: [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [
          { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' },
          { name: 'Example Site.url', path: 'Research/Example Site.url', kind: 'link', provenance: 'created' },
        ],
      },
      { name: 'Archive', path: 'Archive', kind: 'notebook', children: [] },
    ],
  };
  const bridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => vault),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons: true, autosaveDelay: 0 })),
      readNote: vi.fn(async () => '# Idea'),
      saveNote: vi.fn(async () => undefined),
      createNote: vi.fn(async () => vault),
      createLink: vi.fn(async () => ({ path: 'Research/Example Site.url', vault })),
      saveLink: vi.fn(async () => ({ path: 'Research/Example Site.url', vault })),
      readAttachment: vi.fn(async () => ({ path: 'Research/Example Site.url', text: LINK_FILE_TEXT, kind: '.url' })),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async (): Promise<VaultInfo | { pointer: PointerImport } | null> => null),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  return {
    bridge,
    vault,
    menu: (command: MenuCommand) => act(() => listener?.(command)),
  };
}

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

async function showNotesFiles() {
  fireEvent.keyDown(document, { key: '3', ctrlKey: true });
  await screen.findByRole('grid', { name: 'Notes and files' });
}

describe('link notes in the app', () => {
  it('adds a link from the sidebar button as a grid item, never into a note', async () => {
    const { bridge } = installBridge();
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Research' }));
    fireEvent.click(
      within(container.querySelector('.vault-actions')!).getByRole('button', { name: 'Add link' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add link' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Example Site' } });
    fireEvent.change(within(dialog).getByLabelText('Web address'), { target: { value: LINK_URL } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    await waitFor(() =>
      expect(bridge.vault.createLink).toHaveBeenCalledWith({
        title: 'Example Site',
        url: LINK_URL,
        notebookPath: 'Research',
      }),
    );
    expect(bridge.vault.createNote).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('Added link Example Site.'),
    );
  });

  it('shows the link with Type link and opens its address on Enter', async () => {
    const { bridge } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Research' }));
    await showNotesFiles();
    expect(screen.getByRole('gridcell', { name: 'Example Site.url' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'link' })).toBeInTheDocument();
    const cell = gridNameCell('Research/Example Site.url');
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Enter' });
    await waitFor(() => expect(bridge.vault.readAttachment).toHaveBeenCalledWith('Research/Example Site.url'));
    await waitFor(() => expect(bridge.vault.openUrl).toHaveBeenCalledWith(LINK_URL));
  });

  it('offers Add as link when importing a Google Docs pointer file', async () => {
    const { bridge, menu } = installBridge();
    const pointerUrl = 'https://docs.google.com/document/d/abc/edit';
    const guidance =
      'A Google Docs (.gdoc) file is only a link to an online document and contains no document text.';
    bridge.vault.importFile.mockResolvedValueOnce({
      pointer: { url: pointerUrl, extension: '.gdoc', guidance },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Research' }));
    menu('import-file');
    const dialog = await screen.findByRole('dialog', { name: 'Add link' });
    expect(within(dialog).getByText(/only a link to an online document/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Web address')).toHaveValue(pointerUrl);
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'My Doc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    await waitFor(() =>
      expect(bridge.vault.createLink).toHaveBeenCalledWith({
        title: 'My Doc',
        url: pointerUrl,
        notebookPath: 'Research',
      }),
    );
  });

  it('edits a link title and address from the grid context menu', async () => {
    const { bridge } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Research' }));
    await showNotesFiles();
    const cell = gridNameCell('Research/Example Site.url');
    fireEvent.contextMenu(cell, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole('menu', { name: 'Actions for Example Site.url' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit link' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Example Site');
    expect(within(dialog).getByLabelText('Web address')).toHaveValue(LINK_URL);
    fireEvent.change(within(dialog).getByLabelText('Web address'), {
      target: { value: 'https://example.com/new' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(bridge.vault.saveLink).toHaveBeenCalledWith({
        path: 'Research/Example Site.url',
        title: 'Example Site',
        url: 'https://example.com/new',
      }),
    );
  });
});
