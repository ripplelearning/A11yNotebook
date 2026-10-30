// Reproduction probe for batch 5: Alt+Left history navigation.
// Navigates notebooks -> note, then presses Alt+Left and observes where
// each press lands. This test is diagnostic: it prints the landing view
// after each press so the double-press behavior can be seen, and asserts
// the first press returns to the notes grid.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
  window.localStorage.clear();
});

function renderLibrary() {
  const vault: VaultInfo = {
    name: 'Study',
    path: 'C:/Study',
    entries: [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' }],
      },
      { name: 'Archive', path: 'Archive', kind: 'notebook', children: [] },
    ],
  };
  const bridge = {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => vault),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Idea'),
      onSecurityLocked: vi.fn(() => () => undefined),
      unlockVault: vi.fn(async () => vault),
    },
    onMenuCommand: vi.fn(() => () => undefined),
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  render(<App />);
  return bridge;
}

describe('history navigation probe', () => {
  it('goes back to the notes grid on the first Alt+Left from a note', async () => {
    renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    // Ctrl+2 opens the notebooks screen, Enter opens Research in notes-files.
    fireEvent.keyDown(document, { key: '2', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    await screen.findByText('Items in Research');
    // Open the note from the notes grid.
    const grid = screen.getByRole('grid', { name: 'Notes and files' });
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    // First Alt+Left: should land back on the notes grid in Research.
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(screen.getByText('Items in Research')).toBeInTheDocument());
  });

  it('does not need a second Alt+Left after retargeting the tree while a note is open', async () => {
    renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    fireEvent.keyDown(document, { key: '2', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    await screen.findByText('Items in Research');
    const grid = screen.getByRole('grid', { name: 'Notes and files' });
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    // Retargeting the tree to another notebook while the note stays open
    // changes only the notebook context, not the visible note. One
    // Alt+Left must return to the notes grid, not step through that
    // invisible context change first.
    fireEvent.click(screen.getByRole('treeitem', { name: /Archive/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(screen.getByText('Items in Research')).toBeInTheDocument());
  });
});
