import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

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
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

const looseVault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [{ name: 'Loose.md', path: 'Loose.md', kind: 'note', provenance: 'created' }],
};

function renderLibrary(initialVault: VaultInfo | null) {
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
      get: vi.fn(async () => initialVault),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getRecentLibraries: vi.fn(async () => []),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Idea\n\nIdea again'),
      readAttachment: vi.fn(async () => ({ path: 'Research/Idea.md', text: 'Idea', kind: 'text' })),
      rename: vi.fn(),
      delete: vi.fn(),
      open: vi.fn(async () => vault),
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
  return { menu: (command: MenuCommand) => act(() => menuListener?.(command)), bridge };
}

async function openNotebook() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
}

function statusBar() {
  return screen.getByLabelText('Status bar');
}

describe('Quick Task with no notebook open', () => {
  it('opens the task dialog at once, with the notebook chooser after the text box', async () => {
    const { menu, bridge } = renderLibrary(vault);
    await openNotebook();
    // Back to the Notebooks landing grid: the remembered notebook path
    // stays in state, but no notebook is visibly open anymore.
    menu('show-notebooks');
    await screen.findByRole('grid', { name: 'Notebooks' });
    menu('quick-task');
    const dialog = screen.getByRole('dialog', { name: 'Quick Task' });
    expect(screen.queryByRole('dialog', { name: 'Quick Task notebook' })).not.toBeInTheDocument();
    const textBox = within(dialog).getByRole('textbox', { name: 'Quick Task' });
    expect(document.activeElement).toBe(textBox);
    // The chooser follows the text box and is preselected to the most
    // recent notebook, so saving without choosing uses it.
    const chooser = within(dialog).getByLabelText('Notebook');
    expect(chooser).toHaveValue('Research');
    fireEvent.change(textBox, { target: { value: 'Buy milk' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(bridge.vault.createTask).toHaveBeenCalledWith({ notebookPath: 'Research', text: 'Buy milk' }),
    );
    expect(statusBar()).toHaveTextContent('Task created in Research.');
  });

  it('opens the task dialog directly when a notebook is open, with no chooser', async () => {
    const { menu, bridge } = renderLibrary(vault);
    await openNotebook();
    menu('quick-task');
    const dialog = screen.getByRole('dialog', { name: 'Quick Task' });
    expect(within(dialog).queryByLabelText('Notebook')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Quick Task' }), {
      target: { value: 'Buy milk' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(bridge.vault.createTask).toHaveBeenCalledWith({ notebookPath: 'Research', text: 'Buy milk' }),
    );
    expect(statusBar()).toHaveTextContent('Task created in Research.');
  });

  it('asks for a library first when none is open, then shows the task dialog with the chooser', async () => {
    const { menu } = renderLibrary(null);
    await screen.findByRole('tab', { name: 'Libraries' });
    menu('quick-task');
    expect(screen.getByRole('dialog', { name: 'Quick Task library' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open library…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quick Task' });
    expect(within(dialog).getByLabelText('Notebook')).toHaveValue('Research');
  });

  it('requires a destination to be picked when the library has no notebooks', async () => {
    const { menu, bridge } = renderLibrary(looseVault);
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    menu('quick-task');
    const dialog = screen.getByRole('dialog', { name: 'Quick Task' });
    const chooser = within(dialog).getByLabelText('Notebook');
    expect(chooser).toHaveValue('__choose__');
    expect(within(dialog).getByRole('button', { name: 'OK' })).toBeDisabled();
    fireEvent.change(chooser, { target: { value: '' } });
    expect(within(dialog).getByRole('button', { name: 'OK' })).not.toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Quick Task' }), {
      target: { value: 'Buy milk' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(bridge.vault.createTask).toHaveBeenCalledWith({ notebookPath: undefined, text: 'Buy milk' }),
    );
    expect(statusBar()).toHaveTextContent('Task created in Study.');
  });
});
