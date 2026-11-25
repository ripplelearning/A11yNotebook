import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';
import { openGridItem, openTreeLeaf } from './library-navigation';

afterEach(() => {
  delete window.a11yNotebook;
});

function renderLibrary(vault: VaultInfo, readAttachment?: () => Promise<unknown>) {
  let menuListener: ((command: MenuCommand) => void) | undefined;
  const bridge = {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
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
      readAttachment: vi.fn(
        async () => readAttachment?.() ?? { path: 'Research/Data.txt', text: 'seeded data', kind: 'text' },
      ),
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
  return { vault, bridge, menu: (command: MenuCommand) => act(() => menuListener?.(command)) };
}

const notesVault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [
        { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' },
        { name: 'Data.txt', path: 'Research/Data.txt', kind: 'attachment', provenance: 'created' },
      ],
    },
    { name: 'Root.md', path: 'Root.md', kind: 'note', provenance: 'created' },
  ],
};

async function openResearchNotebook(menu: (command: MenuCommand) => void) {
  menu('show-notebooks');
  const notebooks = screen.getByRole('grid', { name: 'Notebooks' });
  fireEvent.keyDown(within(notebooks).getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByRole('grid', { name: 'Notes and files' });
  expect(document.title).toBe('Notes & Files | Research | A11y Notebook');
}

describe('file-open title bar', () => {
  it('titles an open note with its file, notebook, and library names', async () => {
    const { menu } = renderLibrary(notesVault);
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    await openResearchNotebook(menu);
    openGridItem('Research/Idea.md');
    await screen.findByRole('heading', { name: 'Idea', level: 2 });
    expect(document.title).toBe('Idea | Research | Study | A11y Notebook');
  });

  it('reverts to the view title when the open note is closed', async () => {
    const { menu } = renderLibrary(notesVault);
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    await openResearchNotebook(menu);
    openGridItem('Research/Idea.md');
    await screen.findByRole('heading', { name: 'Idea', level: 2 });
    expect(document.title).toBe('Idea | Research | Study | A11y Notebook');
    fireEvent.click(screen.getByRole('button', { name: 'Close Idea' }));
    await screen.findByRole('grid', { name: 'Notes and files' });
    expect(document.title).toBe('Notes & Files | Research | A11y Notebook');
  });

  it('omits the notebook segment for an open note at the library root', async () => {
    renderLibrary(notesVault);
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    await openTreeLeaf(/Root.md/);
    await screen.findByRole('heading', { name: 'Root', level: 2 });
    expect(document.title).toBe('Root | Study | A11y Notebook');
  });

  it('titles an open attachment with its file, notebook, and library names', async () => {
    const { menu } = renderLibrary(notesVault);
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    await openResearchNotebook(menu);
    openGridItem('Research/Data.txt');
    await screen.findByText('seeded data');
    expect(document.title).toBe('Data.txt | Research | Study | A11y Notebook');
  });
});
