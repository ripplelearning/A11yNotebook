import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';
import { DEFAULT_SETTINGS } from '../shared/settings';

afterEach(() => {
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

const vault: VaultInfo = {
  path: '/study',
  name: 'Study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [{ name: 'Legacy.md', path: 'Research/Legacy.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

function setup() {
  const bridge = {
    onMenuCommand: vi.fn(() => () => undefined),
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      ...vaultExtensions(),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons: true })),
      get: vi.fn(async () => vault),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      importFile: vi.fn(async () => vault),
      readNote: vi.fn(async () => '# Legacy'),
      isNoteEncrypted: vi.fn(async () => false),
    },
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  render(<App />);
  return bridge;
}

function press(key: string) {
  fireEvent.keyDown(document.body, { key, ctrlKey: true });
}

async function openNotesFilesView() {
  await screen.findByRole('heading', { name: 'Study' });
  press('2');
  const notebooks = screen.getByRole('tabpanel', { name: 'Notebooks in Study' });
  fireEvent.click(within(notebooks).getByRole('gridcell', { name: 'Research' }));
  press('3');
  return screen.getByRole('tabpanel', { name: 'Notes and Files in Research' });
}

describe('Notes and Files view reports', () => {
  it('imports into the notebook already chosen for the view instead of demanding a new selection', async () => {
    const bridge = setup();
    const files = await openNotesFilesView();
    // Focus a note in the grid, as a user browsing the view would: the tree
    // selection is now the note, not the notebook.
    fireEvent.click(within(files).getByRole('gridcell', { name: 'Legacy.md' }));
    // Import file is a native File menu command (it has no in-app shortcut;
    // Ctrl+I is italic in the editor), so dispatch it the way the menu does.
    const menu = vi.mocked(bridge.onMenuCommand).mock.calls[0][0];
    menu('import-file');
    await waitFor(() => expect(bridge.vault.importFile).toHaveBeenCalledWith('Research'));
    expect(screen.getByLabelText('Status bar')).not.toHaveTextContent(
      'Select a notebook before importing a file.',
    );
  });

  it('returns focus to the grid when the open note is closed with Ctrl+W', async () => {
    setup();
    const files = await openNotesFilesView();
    const cell = within(files).getByRole('gridcell', { name: 'Legacy.md' });
    fireEvent.keyDown(cell, { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Legacy', level: 2 });
    press('w');
    const filesAgain = await screen.findByRole('tabpanel', { name: 'Notes and Files in Research' });
    const cellAgain = within(filesAgain).getByRole('gridcell', { name: 'Legacy.md' });
    await waitFor(() => expect(cellAgain).toHaveFocus());
  });

  it('names the new-note field for the note being created', async () => {
    setup();
    await openNotesFilesView();
    press('n');
    const dialog = await screen.findByRole('dialog', { name: 'New note' });
    expect(within(dialog).getByRole('textbox', { name: 'New Note Name' })).toHaveFocus();
    expect(document.title).toBe('New note | A11y Notebook');
  });
});
