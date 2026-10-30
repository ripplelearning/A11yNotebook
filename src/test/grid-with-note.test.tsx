// Batch 5: the notes grid stays available while a note is open, and
// Ctrl+Tab announces the note landed on.
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
        children: [
          { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' },
          { name: 'Second.md', path: 'Research/Second.md', kind: 'note', provenance: 'created' },
        ],
      },
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
      readNote: vi.fn(async (notePath: string) => (notePath.endsWith('Idea.md') ? '# Idea' : '# Second')),
      onSecurityLocked: vi.fn(() => () => undefined),
      unlockVault: vi.fn(async () => vault),
    },
    onMenuCommand: vi.fn(() => () => undefined),
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  render(<App />);
}

async function openIdea() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.keyDown(document, { key: '2', ctrlKey: true });
  fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
  const grid = screen.getByRole('grid', { name: 'Notes and files' });
  fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
}

describe('notes grid with an open note', () => {
  it('keeps exactly one notes grid visible and opens a second note from it', async () => {
    renderLibrary();
    await openIdea();
    // The grid stays in the navigation pane while the note is open, and
    // it is the only notes grid mounted: the main grid is unmounted.
    const grids = screen.getAllByRole('grid', { name: 'Notes and files' });
    expect(grids).toHaveLength(1);
    const asideGrid = grids[0];
    expect(within(asideGrid).getByRole('gridcell', { name: 'Second.md' })).toBeInTheDocument();
    fireEvent.keyDown(within(asideGrid).getByRole('gridcell', { name: 'Second.md' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('announces the note landed on with Ctrl+Tab', async () => {
    renderLibrary();
    await openIdea();
    const asideGrid = screen.getByRole('grid', { name: 'Notes and files' });
    fireEvent.keyDown(within(asideGrid).getByRole('gridcell', { name: 'Second.md' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    const statusBar = screen.getByRole('contentinfo', { name: 'Status bar' });
    expect(within(statusBar).getByRole('status')).toHaveTextContent('Idea');
  });
});
