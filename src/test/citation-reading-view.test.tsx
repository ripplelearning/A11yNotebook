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

const entry = {
  id: 'entry-1',
  notebookPath: 'Research',
  sourceType: 'book',
  authors: [{ last: 'Rivera', first: 'Alex' }],
  title: 'Accessible Design',
  year: '2024',
};

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
      getBibliography: vi.fn(async () => [entry]),
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

describe('citation dialog in reading view', () => {
  it('hides insert controls, and switching to edit mode reveals them with the dialog still open', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('open-bibliography');
    expect(screen.getByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
    await screen.findByText('Rivera, A. (2024). Accessible Design.');
    expect(screen.queryByRole('button', { name: 'Insert In-Text Citation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert full bibliography' })).not.toBeInTheDocument();
    expect(screen.queryByText('Inserting is disabled unless the note is open in edit mode.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Switch to edit mode to insert citations' }),
    ).toBeInTheDocument();
    // The entry context menu has no insert item either.
    fireEvent.contextMenu(screen.getByText('Rivera, A. (2024). Accessible Design.'));
    expect(screen.queryByRole('menuitem', { name: 'Insert In-Text Citation' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close menu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close menu' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to edit mode to insert citations' }));
    expect(screen.getByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert In-Text Citation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert full bibliography' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Switch to edit mode to insert citations' })).not.toBeInTheDocument();
  });

  it('has no view toggle in reading view, and switching views still works from the keyboard path', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('open-bibliography');
    expect(screen.getByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Citation view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Citation generator' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bibliography' })).not.toBeInTheDocument();
    // With the toggle gone, the keyboard commands are the only way to
    // switch views while the dialog is open — including from reading
    // view, where the generator shows its switch-to-edit action. (The
    // native-menu path drops commands while a dialog is open, so drive
    // the switch as a key event, like the view-switch test does.)
    fireEvent.keyDown(document.body, { key: 'C', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Citations' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert In-Text Citation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to edit mode to insert citations' }));
    expect(screen.getByRole('dialog', { name: 'Citations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert In-Text Citation' })).toBeInTheDocument();
  });

  it('shows insert controls with no switch action in edit mode', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('toggle-read-only-mode');
    menu('open-bibliography');
    expect(screen.getByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
    await screen.findByText('Rivera, A. (2024). Accessible Design.');
    expect(screen.getByRole('button', { name: 'Insert In-Text Citation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert full bibliography' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Switch to edit mode to insert citations' })).not.toBeInTheDocument();
    expect(screen.queryByText('Inserting is disabled unless the note is open in edit mode.')).not.toBeInTheDocument();
  });
});
