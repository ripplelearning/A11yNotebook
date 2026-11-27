import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import NotesFilesScreen from '../renderer/features/screens/NotesFilesScreen';
import { dispatchCommand, getCommandById, type CommandActionContext } from '../shared/command-registry';
import type { NotebookBridge } from '../shared/bridge';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { VaultInfo, VaultTask } from '../shared/types';
import { vaultExtensions } from './vault-extensions';
import { openTreeLeaf } from './library-navigation';

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
      {
        name: 'Templates',
        path: 'Templates',
        kind: 'notebook',
        children: [{ name: 'Daily.md', path: 'Templates/Daily.md', kind: 'note', provenance: 'created' }],
      },
      { name: 'Root.md', path: 'Root.md', kind: 'note', provenance: 'created' },
    ],
  };
  const bridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
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
      saveNote: vi.fn(async (path: string, content: string) => {
        void path;
        void content;
      }),
      getTasks: vi.fn(async (): Promise<VaultTask[]> => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        showCommandButtons: true,
        autosaveDelay: 0,
        defaultNoteOpenMode,
        templatesSeeded: true,
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
  await screen.findByRole('heading', { name: 'Study library' });
  shortcut('2');
  const cell = screen.getByRole('gridcell', { name: 'Research' });
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: 'Enter' });
  await screen.findByText('Items in Research');
}

/** Opens a note from the notes grid that stays in the navigation pane while a note is open. */
function openNavGridNote(name: string) {
  const navigation = screen.getByRole('complementary', { name: 'Navigation pane' });
  fireEvent.keyDown(within(navigation).getByRole('gridcell', { name }), { key: 'Enter' });
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
    await screen.findByRole('heading', { name: 'Study library' });
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
    await openTreeLeaf(/Root\.md/);
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
    await screen.findByRole('heading', { name: 'Study library' });
    await openTreeLeaf(/Root\.md/);
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
    const input = within(dialog).getByRole('textbox', { name: 'Task description' });
    // Focus starts in the Associate with dropdown, not the description,
    // so a screen reader user reaches the association choice first.
    expect(within(dialog).getByLabelText('Associate with')).toHaveFocus();
    expect(input).not.toHaveFocus();
    // With no task text the dialog cannot create: the button stays
    // disabled instead of submitting an empty task.
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled();
    // Ctrl+N opens the same unified dialog as the grid menu: the task
    // is saved as its own note in the Tasks notebook and only linked to
    // the associated note, never written into it, and templates are
    // never offered as an association.
    const options = await waitFor(() => {
      const found = within(within(dialog).getByLabelText('Associate with')).getAllByRole('option');
      expect(found.map((option) => option.textContent)).toEqual([
        'No association',
        'Research/Idea.md',
        'Research/Other.md',
        'Root.md',
        'Research',
        'Templates',
      ]);
      return found;
    });
    expect(options).toHaveLength(6);
    fireEvent.change(within(dialog).getByLabelText('Associate with'), {
      target: { value: 'Research/Idea.md' },
    });
    fireEvent.change(input, { target: { value: 'Plan review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(bridge.vault.createTask).toHaveBeenCalledWith({
        notebookPath: 'Tasks',
        text: 'Plan review',
        due: '',
        reminder: '',
        priority: 'medium',
      }),
    );
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument());
  });

  it('keeps a failed task dialog open with its text and allows Escape cancellation', async () => {
    const { bridge } = setup();
    bridge.vault.createTask.mockRejectedValueOnce(new Error('Task could not be saved.'));
    await screen.findByRole('heading', { name: 'Study library' });
    shortcut('4');
    shortcut('n');
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    // Wait for the dialog options to render.
    await within(dialog).findByRole('option', { name: 'Research/Idea.md' });
    const input = within(dialog).getByRole('textbox', { name: 'Task description' });
    fireEvent.change(input, { target: { value: 'Keep this text' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await screen.findByRole('alert');
    expect(input).toHaveValue('Keep this text');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument();
  });

  it('opens the same unified dialog from Ctrl+N whatever the Tasks notebook filter is', async () => {
    const { bridge } = setup();
    bridge.vault.getTasks.mockResolvedValue([
      { id: 'existing-task', path: 'Planning/Tasks.md', line: 1, text: 'Existing task', complete: false },
    ]);
    await selectResearch();
    shortcut('4');
    fireEvent.change(screen.getByRole('combobox', { name: 'Notebook' }), { target: { value: 'Planning' } });
    shortcut('n');
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    // The filter narrows the table, not the dialog: every note in the
    // library is still offered as the associated note.
    await waitFor(() =>
      expect(
        within(within(dialog).getByLabelText('Associate with')).getAllByRole('option'),
      ).toHaveLength(6),
    );
    fireEvent.change(within(dialog).getByLabelText('Associate with'), { target: { value: 'Root.md' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task description' }), {
      target: { value: 'Review plan' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(bridge.vault.createTask).toHaveBeenCalledWith({
        notebookPath: 'Tasks',
        text: 'Review plan',
        due: '',
        reminder: '',
        priority: 'medium',
      }),
    );
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
  });

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
    await screen.findByRole('heading', { name: 'Study library' });
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
  it.each(['read', 'edit'] as const)('applies %s on open and retains the note\'s mode on tab switch', async (mode) => {
    setup(mode);
    await selectResearch();
    const panel = screen.getByRole('tabpanel');
    fireEvent.keyDown(within(panel).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Idea', level: 2 });
    const editor = () => screen.queryByRole('textbox', { name: 'Markdown source' });
    await waitFor(() => expect(!!editor()).toBe(mode === 'edit'));
    shortcut('e');
    expect(!!editor()).toBe(mode !== 'edit');
    openNavGridNote('Other.md');
    await screen.findByRole('heading', { name: 'Other', level: 2 });
    expect(!!editor()).toBe(mode === 'edit');
    fireEvent.click(screen.getByRole('tab', { name: 'Idea' }));
    // Returning to an open note restores its toggled mode instead of resetting to the default.
    expect(!!editor()).toBe(mode !== 'edit');
    shortcut('e');
    openNavGridNote('Idea.md');
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
      templatesSeeded: true,
    });
    await selectResearch();
    const panel = screen.getByRole('tabpanel');
    fireEvent.keyDown(within(panel).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'Unsaved' } });
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
    openNavGridNote('Other.md');
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('tab', { name: /Idea/ }));
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
    shortcut('e');
    expect(status()).toHaveTextContent('Save this note before editing it again.');
  });
});
