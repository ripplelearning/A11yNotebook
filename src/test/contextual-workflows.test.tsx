import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import NotesFilesScreen from '../renderer/features/screens/NotesFilesScreen';
import { dispatchCommand, getCommandById, type CommandActionContext } from '../shared/command-registry';
import type { NotebookBridge } from '../shared/bridge';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { VaultInfo, VaultTask } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
  vi.useRealTimers();
});

function setup(defaultNoteOpenMode: 'read' | 'edit' = 'read') {
  const vault: VaultInfo = {
    name: 'Study library',
    path: '/study',
    entries: [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [
          { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' },
          { name: 'Other.md', path: 'Research/Other.md', kind: 'note', provenance: 'created' },
        ],
      },
      { name: 'Root.md', path: 'Root.md', kind: 'note', provenance: 'created' },
    ],
  };
  const bridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    onMenuCommand: vi.fn(() => () => undefined),
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => vault),
      open: vi.fn(async () => vault),
      createLibrary: vi.fn(async () => ({ ...vault, path: '/new', name: 'New library' })),
      createTask: vi.fn(async () => []),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      readNote: vi.fn(async () => '# Body'),
      getTasks: vi.fn(async (): Promise<VaultTask[]> => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        showCommandButtons: true,
        autosaveDelay: 0,
        defaultNoteOpenMode,
      })),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      isNoteEncrypted: vi.fn(async () => false),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  render(<App />);
  return { bridge, vault };
}

const shortcut = (key: string) => fireEvent.keyDown(document, { key, ctrlKey: true });
const status = () => within(screen.getByLabelText('Status bar')).getByRole('status');

async function selectResearch() {
  await screen.findByRole('treeitem', { name: /Research/ });
  shortcut('2');
  const cell = screen.getByRole('gridcell', { name: 'Research' });
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: 'Enter' });
  await screen.findByText('Items in Research');
}

async function expandResearch() {
  const notebook = await screen.findByRole('treeitem', { name: /Research/ });
  fireEvent.keyDown(notebook, { key: 'ArrowRight' });
}

describe('contextual navigation and creation', () => {
  it('owns Ctrl+N in the registry and dispatches the contextual callback', () => {
    const newContextual = vi.fn();
    expect(getCommandById('new-contextual')?.shortcut).toBe('Ctrl+N');
    expect(getCommandById('new-notebook')?.shortcut).toBeUndefined();
    expect(dispatchCommand('new-contextual', { newContextual } as unknown as CommandActionContext)).toBeUndefined();
    expect(newContextual).toHaveBeenCalledOnce();
  });

  it('announces exact contextual destinations and repeats after clearing, without moving focus', async () => {
    setup();
    await selectResearch();
    const focus = document.activeElement;
    const destinations = [
      ['1', 'Study library'],
      ['2', 'Notebooks in Study library'],
      ['3', 'Notes and Files in Research'],
      ['4', 'Tasks'],
      ['5', 'Cognitive Tools'],
      ['0', 'Contents'],
    ];
    for (const [key, message] of destinations) {
      shortcut(key);
      await waitFor(() => expect(status()).toHaveTextContent(message));
    }
    shortcut('3');
    fireEvent.click(screen.getByRole('gridcell', { name: 'Other.md' }));
    await waitFor(() => expect(status()).toHaveTextContent('Notes and Files in Research'));
    const selectedFocus = document.activeElement;
    shortcut('3');
    expect(status()).toBeEmptyDOMElement();
    expect(document.activeElement).toBe(selectedFocus);
    await waitFor(() => expect(status()).toHaveTextContent(/^Notes and Files in Research$/));
    expect(focus).not.toBe(screen.getByRole('tabpanel'));
  });

  it('announces unscoped destinations with no library', async () => {
    render(<App />);
    for (const [key, label] of [
      ['1', 'Libraries'],
      ['2', 'Notebooks'],
      ['3', 'Notes and Files'],
    ]) {
      shortcut(key);
      await waitFor(() => expect(status()).toHaveTextContent(new RegExp(`^${label}$`)));
    }
  });

  it('creates a library from Libraries and keeps explicit notebook creation separate', async () => {
    const { bridge } = setup();
    await screen.findByRole('treeitem', { name: /Research/ });
    shortcut('1');
    shortcut('n');
    await waitFor(() => expect(bridge.vault.createLibrary).toHaveBeenCalledOnce());
    expect(bridge.vault.open).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Opening library' })).not.toBeInTheDocument());
    shortcut('2');
    shortcut('n');
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
  });

  it('creates notes in the selected notebook rather than the last grid selection', async () => {
    const { bridge } = setup();
    await selectResearch();
    fireEvent.click(screen.getByRole('treeitem', { name: /Root.md/ }));
    await screen.findByRole('heading', { name: 'Root', level: 2 });
    shortcut('3');
    shortcut('n');
    const dialog = screen.getByRole('dialog', { name: 'New note' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'New Note Name' }), { target: { value: 'Created' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New note' }));
    await waitFor(() => expect(bridge.vault.createNote).toHaveBeenCalledWith('Research/Created.md'));
  });

  it('blocks contextual library creation while a note has unsaved changes', async () => {
    const { bridge } = setup('edit');
    fireEvent.click(await screen.findByRole('treeitem', { name: /Root.md/ }));
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    fireEvent.change(editor, { target: { value: 'Do not discard' } });
    shortcut('1');
    shortcut('n');
    expect(bridge.vault.createLibrary).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent('Save or resolve unsaved changes before opening another library.');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 75)));
    expect(status()).toHaveTextContent('Save or resolve unsaved changes before opening another library.');
  });

  it('shows visible note creation controls and initializes templates in the selected notebook', async () => {
    setup();
    await selectResearch();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('button', { name: 'New note' })).toBeEnabled();
    fireEvent.click(within(panel).getByRole('button', { name: 'New note from template' }));
    const dialog = await screen.findByRole('dialog', { name: 'New note from template' });
    expect(within(dialog).getByRole('combobox', { name: /Notebook/ })).toHaveValue('Research');
  });

  it('uses an accessible task dialog and selected notebook for task creation', async () => {
    const { bridge } = setup();
    await selectResearch();
    shortcut('4');
    shortcut('n');
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const input = within(dialog).getByRole('textbox', { name: 'Task text' });
    expect(input).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter task text.');
    fireEvent.change(input, { target: { value: 'Plan review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(bridge.vault.createTask).toHaveBeenCalledWith({ notebookPath: 'Research', text: 'Plan review' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument());
  });

  it('keeps a failed task dialog open with its text and allows Escape cancellation', async () => {
    const { bridge } = setup();
    bridge.vault.createTask.mockRejectedValueOnce(new Error('Task could not be saved.'));
    await screen.findByRole('treeitem', { name: /Research/ });
    shortcut('4');
    shortcut('n');
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const input = within(dialog).getByRole('textbox', { name: 'Task text' });
    fireEvent.change(input, { target: { value: 'Keep this text' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await screen.findByRole('alert');
    expect(input).toHaveValue('Keep this text');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument();
  });

  it.each([
    { filter: 'Planning', taskPath: 'Planning/Tasks.md', notebookPath: 'Planning' },
    { filter: 'Root', taskPath: 'Tasks.md', notebookPath: undefined },
  ])(
    'prefers task filter $filter over the independently selected notebook',
    async ({ filter, taskPath, notebookPath }) => {
      const { bridge } = setup();
      bridge.vault.getTasks.mockResolvedValue([
        { id: 'existing-task', path: taskPath, line: 1, text: 'Existing task', complete: false },
      ]);
      await selectResearch();
      shortcut('4');
      fireEvent.change(screen.getByRole('combobox', { name: 'Notebook' }), { target: { value: filter } });
      shortcut('n');
      const dialog = screen.getByRole('dialog', { name: 'New task' });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task text' }), {
        target: { value: 'Review plan' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
      await waitFor(() => expect(bridge.vault.createTask).toHaveBeenCalledWith({ notebookPath, text: 'Review plan' }));
    },
  );

  it('cancels pending navigation speech when the visible New note control opens a dialog', async () => {
    setup();
    await selectResearch();
    shortcut('3');
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'New note' }));
    const dialog = screen.getByRole('dialog', { name: 'New note' });
    expect(within(dialog).getByRole('textbox', { name: 'New Note Name' })).toHaveFocus();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 75)));
    expect(status()).not.toHaveTextContent('Notes and Files in Research');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New note' })).not.toBeInTheDocument();
  });

  it('focuses the full existing cognitive asset type chooser on every Ctrl+N', async () => {
    setup();
    await screen.findByRole('treeitem', { name: /Research/ });
    shortcut('5');
    shortcut('n');
    const chooser = screen.getByRole('combobox', { name: 'New asset type' });
    expect(chooser).toHaveFocus();
    expect(within(chooser).getAllByRole('option')).toHaveLength(5);
    screen.getByRole('textbox', { name: 'New asset name' }).focus();
    shortcut('n');
    expect(chooser).toHaveFocus();
  });

  it('disables note creation controls when no library is available or creation is blocked', () => {
    const props = {
      entries: [],
      selectedPath: null,
      hasLibrary: false,
      onSelect: vi.fn(),
      onOpen: vi.fn(),
      onRename: vi.fn(),
    };
    const { rerender } = render(<NotesFilesScreen {...props} onNewNote={vi.fn()} onNewFromTemplate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'New note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New note from template' })).toBeDisabled();
    rerender(
      <NotesFilesScreen {...props} hasLibrary creationDisabled onNewNote={vi.fn()} onNewFromTemplate={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'New note' })).toBeDisabled();
  });
});

describe('default note opening mode', () => {
  it.each(['read', 'edit'] as const)('applies %s on open, switch, and reopening an existing tab', async (mode) => {
    setup(mode);
    await expandResearch();
    const first = await screen.findByRole('treeitem', { name: /Idea.md/ });
    fireEvent.click(first);
    await screen.findByRole('heading', { name: 'Idea', level: 2 });
    const editor = () => screen.queryByRole('textbox', { name: 'Markdown source' });
    await waitFor(() => expect(!!editor()).toBe(mode === 'edit'));
    shortcut('e');
    expect(!!editor()).toBe(mode !== 'edit');
    fireEvent.click(screen.getByRole('treeitem', { name: /Other.md/ }));
    await screen.findByRole('heading', { name: 'Other', level: 2 });
    expect(!!editor()).toBe(mode === 'edit');
    fireEvent.click(screen.getByRole('tab', { name: 'Idea' }));
    expect(!!editor()).toBe(mode === 'edit');
    shortcut('e');
    fireEvent.click(screen.getByRole('treeitem', { name: /Idea.md/ }));
    await waitFor(() => expect(!!editor()).toBe(mode === 'edit'));
  });

  it('keeps edit-locked notes read-only even when the default is edit', async () => {
    const { bridge } = setup('edit');
    bridge.vault.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      showCommandButtons: true,
      autosaveDelay: 0,
      defaultNoteOpenMode: 'edit',
      noteEditLockMinutes: 1,
    });
    await expandResearch();
    fireEvent.click(await screen.findByRole('treeitem', { name: /Idea.md/ }));
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'Unsaved' } });
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('treeitem', { name: /Other.md/ }));
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('tab', { name: /Idea/ }));
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
    shortcut('e');
    expect(status()).toHaveTextContent('Save this note before editing it again.');
  });
});
