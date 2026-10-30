// Batch 5: switching libraries away and back restores the first
// library's open notes, selected tab, and open task tab.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
  window.localStorage.clear();
});

const vaultA: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

const vaultB: VaultInfo = {
  name: 'Other',
  path: 'C:/Other',
  entries: [
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Note.md', path: 'Archive/Note.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

function renderTwoLibraries() {
  let current = vaultA;
  let menuListener: ((command: MenuCommand) => void) | undefined;
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
      get: vi.fn(async () => current),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async (notePath: string) => (notePath === 'Research/Idea.md' ? '# Idea' : '# Note')),
      onSecurityLocked: vi.fn(() => () => undefined),
      unlockVault: vi.fn(async () => current),
      openLibraryPath: vi.fn(async (libraryPath: string) => {
        current = libraryPath === vaultB.path ? vaultB : vaultA;
        return current;
      }),
      getRecentLibraries: vi.fn(async () => [
        { name: 'Study', path: 'C:/Study', lastOpenedAt: '' },
        { name: 'Other', path: 'C:/Other', lastOpenedAt: '' },
      ]),
    },
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = undefined;
      };
    },
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  render(<App />);
  const menu = (command: MenuCommand) => act(() => menuListener?.(command));
  return { bridge, menu };
}

describe('library switch state', () => {
  it('restores open notes and the tasks tab when switching back', async () => {
    const { menu } = renderTwoLibraries();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    // Open the Research notebook, then the Idea note, then the Tasks tab.
    fireEvent.keyDown(document, { key: '2', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    await screen.findByText('Items in Research');
    const grid = screen.getByRole('grid', { name: 'Notes and files' });
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    menu('show-tasks');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toBeInTheDocument());

    // Switch to the Other library from the Libraries grid.
    fireEvent.keyDown(document, { key: '1', ctrlKey: true });
    const librariesGrid = await screen.findByRole('grid', { name: 'Libraries' });
    fireEvent.keyDown(within(librariesGrid).getByRole('gridcell', { name: 'Other' }), { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Other', level: 2 });
    expect(screen.queryByRole('tab', { name: 'Idea' })).not.toBeInTheDocument();

    // Switch back: the note tab, the tasks tab, and the note selection return.
    fireEvent.keyDown(document, { key: '1', ctrlKey: true });
    const librariesGridBack = await screen.findByRole('grid', { name: 'Libraries' });
    fireEvent.keyDown(within(librariesGridBack).getByRole('gridcell', { name: 'Study' }), { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  });
});
