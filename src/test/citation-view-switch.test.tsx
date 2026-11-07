import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
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
    ],
  };
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
      get: vi.fn(async () => vault),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getBibliography: vi.fn(async () => []),
      saveBibliography: vi.fn(async (_notebook: string, entries: never[]) => entries),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Idea\n\nIdea again'),
      readAttachment: vi.fn(async () => ({ path: 'Research/Idea.md', text: 'Idea', kind: 'text' })),
      rename: vi.fn(),
      delete: vi.fn(),
      open: vi.fn(),
      onSecurityLocked: vi.fn(() => () => undefined),
      unlockVault: vi.fn(async () => vault),
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
  return { menu: (command: MenuCommand) => act(() => menuListener?.(command)) };
}

async function openNote() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
  const grid = screen.getByRole('grid', { name: 'Notes and files' });
  fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
  await screen.findByText('Idea again');
}

describe('citation dialog view switching', () => {
  it('switches between generator and bibliography with the keyboard commands while open', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('toggle-read-only-mode');
    menu('open-citation-generator');
    expect(screen.getByRole('dialog', { name: 'Citations' })).toBeInTheDocument();
    // The reported bug is the keyboard toggles: Ctrl+Shift+J / Ctrl+Shift+C
    // are matched by the renderer's global keydown listener, so drive them
    // as key events rather than menu commands.
    fireEvent.keyDown(document.body, { key: 'J', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'C', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Citations' })).toBeInTheDocument();
  });

  it('opens the bibliography directly from reading view', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('open-bibliography');
    expect(screen.getByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
  });
});
