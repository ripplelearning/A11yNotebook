import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo, VaultTask } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

const baseVault: VaultInfo = {
  name: 'Study',
  path: '/study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [
        { name: 'Note.md', path: 'Research/Note.md', kind: 'note', provenance: 'created' },
        { name: 'Plain.md', path: 'Research/Plain.md', kind: 'note', provenance: 'created' },
      ],
    },
  ],
};

const noteTasks: VaultTask[] = [
  { id: 'task-1', path: 'Research/Note.md', text: 'Do it', complete: false },
  { id: 'task-2', path: 'Research/Note.md', text: 'Do it again', complete: false },
];

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

function withoutEntry(vault: VaultInfo, path: string): VaultInfo {
  const remove = (entries: VaultInfo['entries']): VaultInfo['entries'] =>
    entries
      .filter((entry) => entry.path !== path && !entry.path.startsWith(`${path}/`))
      .map((entry) => (entry.children ? { ...entry, children: remove(entry.children) } : entry));
  return { ...vault, entries: remove(vault.entries) };
}

function setup() {
  let current = structuredClone(baseVault);
  let menuListener: (command: MenuCommand) => void = () => undefined;
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => current),
      get: vi.fn(async () => current),
      readNote: vi.fn(async () => '# Note\n\n- [ ] Do it\n'),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => noteTasks),
      getTaskLinks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getReadingPosition: vi.fn(async () => null),
      setReadingPosition: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
      delete: vi.fn(async (path: string) => {
        current = withoutEntry(current, path);
        return current;
      }),
      deletePermanently: vi.fn(async (path: string) => {
        current = withoutEntry(current, path);
        return current;
      }),
    },
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = () => undefined;
      };
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  render(<App />);
  const menu = (command: MenuCommand) => act(() => menuListener(command));
  return { bridge, menu };
}

async function loadLibraryAndTasks(menu: (command: MenuCommand) => void) {
  await screen.findByRole('heading', { name: 'Study' });
  // The guard counts the Tasks view's task state, so wait until it is
  // loaded before deleting anything.
  menu('show-tasks');
  await screen.findByText('2 tasks shown.');
  // The Notes & Files tab only exists once a notebook is selected, so
  // return through the Notebooks view.
  menu('show-notebooks');
}

async function openNotebook() {
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
}

describe('delete guard for notes containing tasks', () => {
  it('warns before trashing a note that contains tasks and cancels without deleting', async () => {
    const { bridge, menu } = setup();
    await loadLibraryAndTasks(menu);
    await openNotebook();
    const cell = screen.getByRole('gridcell', { name: 'Note.md' });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Delete note' });
    expect(
      within(dialog).getByText(/This note “Note\.md” contains 2 tasks\. Deleting the note will also delete them\./),
    ).toBeInTheDocument();
    expect(bridge.vault.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete note' })).not.toBeInTheDocument(),
    );
    expect(bridge.vault.delete).not.toHaveBeenCalled();
  });

  it('deletes the note after confirming the guard', async () => {
    const { bridge, menu } = setup();
    await loadLibraryAndTasks(menu);
    await openNotebook();
    const cell = screen.getByRole('gridcell', { name: 'Note.md' });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Delete note' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bridge.vault.delete).toHaveBeenCalledWith('Research/Note.md'));
  });

  it('deletes a note with no tasks without showing the guard', async () => {
    const { bridge, menu } = setup();
    await loadLibraryAndTasks(menu);
    await openNotebook();
    const cell = screen.getByRole('gridcell', { name: 'Plain.md' });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Delete' });
    await waitFor(() => expect(bridge.vault.delete).toHaveBeenCalledWith('Research/Plain.md'));
    expect(screen.queryByRole('dialog', { name: 'Delete note' })).not.toBeInTheDocument();
  });

  it('warns before deleting a notebook that contains tasks in its notes', async () => {
    const { bridge, menu } = setup();
    await loadLibraryAndTasks(menu);
    menu('show-notebooks');
    const cell = await screen.findByRole('gridcell', { name: 'Research' });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Delete notebook' });
    expect(
      within(dialog).getByText(
        /This notebook “Research” contains 2 tasks in its notes\. Deleting the notebook will also delete them\./,
      ),
    ).toBeInTheDocument();
    expect(bridge.vault.delete).not.toHaveBeenCalled();
  });

  it('warns before permanently deleting a note that contains tasks', async () => {
    const { bridge, menu } = setup();
    await loadLibraryAndTasks(menu);
    await openNotebook();
    const cell = screen.getByRole('gridcell', { name: 'Note.md' });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Delete', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Delete note' });
    expect(within(dialog).getByText(/cannot be undone and does not go to the Recycle Bin/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(bridge.vault.deletePermanently).toHaveBeenCalledWith('Research/Note.md', false));
  });
});
