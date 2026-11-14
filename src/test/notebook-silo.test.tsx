import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultEntry, VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

const vault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

function renderLibrary() {
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
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Old'),
      readAttachment: vi.fn(async () => ({ path: 'Archive/Old.md', text: 'Old', kind: 'text' })),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async (path: string) => {
        const name = path.split('/').at(-1)!;
        const notebook: VaultEntry = { name, path, kind: 'notebook', children: [] };
        if (!path.includes('/')) return { ...vault, entries: [...vault.entries, notebook] };
        const parentPath = path.split('/').slice(0, -1).join('/');
        return {
          ...vault,
          entries: vault.entries.map((entry) =>
            entry.path === parentPath ? { ...entry, children: [...(entry.children ?? []), notebook] } : entry,
          ),
        };
      }),
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
  // Tests in this file clear localStorage to reset search scope; without
  // the suppression the guided tour would open over the app on render and
  // swallow the keyboard shortcuts these tests use to navigate.
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  render(<App />);
  return { vault, bridge, menu: (command: MenuCommand) => act(() => menuListener?.(command)) };
}

async function openNewNotebookDialog(menu: (command: MenuCommand) => void) {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  // Opening Archive selects it: its Notes and Files view proves the selection.
  fireEvent.doubleClick(screen.getByRole('gridcell', { name: 'Archive' }));
  expect(screen.getByText('Items in Archive')).toBeInTheDocument();
  // The tab strip only ever shows the current view, so switch views with the menu command.
  menu('show-notebooks');
  fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'New notebook' }));
  return screen.getByRole('dialog', { name: 'New notebook' });
}

async function submitNotebookName(dialog: HTMLElement, name: string) {
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'New Notebook Name' }), {
    target: { value: name },
  });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'New notebook' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('notebook silo: creating notebooks', () => {
  it('creates a notebook at the Library root by default when Archive is selected, and selects it', async () => {
    const { bridge, menu } = renderLibrary();
    const dialog = await openNewNotebookDialog(menu);

    const location = within(dialog).getByRole('combobox', { name: 'Location' });
    expect(location).toHaveValue('');
    expect(within(location).getByRole('option', { name: 'Library root' })).toBeInTheDocument();
    expect(within(location).getByRole('option', { name: 'Inside Archive' })).toBeInTheDocument();

    await submitNotebookName(dialog, 'Interview Instructions');
    expect(bridge.vault.createNotebook).toHaveBeenCalledWith('Interview Instructions');
    await waitFor(() =>
      expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent(
        'Notebook created in the Library root.',
      ),
    );
    menu('show-notes-files');
    expect(screen.getByText('Items in Interview Instructions')).toBeInTheDocument();
  });

  it('creates a notebook inside Archive when that location is chosen, and announces it', async () => {
    const { bridge, menu } = renderLibrary();
    const dialog = await openNewNotebookDialog(menu);

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Location' }), {
      target: { value: 'Archive' },
    });
    await submitNotebookName(dialog, 'Sub');
    expect(bridge.vault.createNotebook).toHaveBeenCalledWith('Archive/Sub');
    await waitFor(() =>
      expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent(
        'Notebook created inside Archive.',
      ),
    );
    menu('show-notes-files');
    expect(screen.getByText('Items in Archive/Sub')).toBeInTheDocument();
  });
});
