import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultEntry, VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS, type NotebookSettings } from '../shared/settings';
import { parseHtmlTasks, parseMarkdownTasks } from '../../electron/vault/tasks';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(
  options: {
    mode?: 'read' | 'edit';
    entries?: VaultEntry[];
    settings?: Partial<NotebookSettings>;
    loadVault?: (vault: VaultInfo) => Promise<VaultInfo | null>;
    loadSettings?: (settings: NotebookSettings) => Promise<NotebookSettings>;
    getSecurityStatus?: NotebookBridge['vault']['getSecurityStatus'];
    onRender?: () => void;
  } = {},
) {
  const vault: VaultInfo = {
    path: '/study',
    name: 'Study',
    entries: options.entries ?? [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [
          { name: 'Plan.md', path: 'Research/Plan.md', kind: 'note', provenance: 'created' },
          { name: 'Plan.html', path: 'Research/Plan.html', kind: 'note', provenance: 'imported' },
        ],
      },
    ],
  };
  let source = '# Plan\n';
  const bridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => {}),
    },
    onMenuCommand: vi.fn(() => () => {}),
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => (options.loadVault ? options.loadVault(vault) : vault)),
      open: vi.fn(async () => vault),
      createLibrary: vi.fn(async () => ({ name: 'New library', path: '/new', entries: [] })),
      getSettings: vi.fn(async () => {
        const settings = {
          ...DEFAULT_SETTINGS,
          showCommandButtons: true,
          ...options.settings,
          defaultNoteOpenMode: options.mode ?? options.settings?.defaultNoteOpenMode ?? 'read',
        } as NotebookSettings;
        return options.loadSettings ? options.loadSettings(settings) : settings;
      }),
      ...(options.getSecurityStatus ? { getSecurityStatus: vi.fn(options.getSecurityStatus) } : {}),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      isNoteEncrypted: vi.fn<(path: string) => Promise<boolean>>(async () => false),
      onSecurityLocked: vi.fn<(callback: () => void) => () => void>(() => () => {}),
      readNote: vi.fn(async () => source),
      saveNote: vi.fn(async (_path: string, content: string) => {
        source = content;
      }),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      openWith: vi.fn(async () => ({ cancelled: false })),
      importEntry: vi.fn(),
      adoptEncrypted: vi.fn<(_: string, password?: string) => Promise<VaultInfo | null>>(),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  render(
    <Profiler id="app" onRender={() => options.onRender?.()}>
      <App />
    </Profiler>,
  );
  return { bridge, vault };
}

function shortcut(key: string, extra = {}) {
  fireEvent.keyDown(document.body, { key, ctrlKey: true, ...extra });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function newAssociatedTask() {
  shortcut('4');
  fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'New task' }));
  return screen.getByRole('dialog', { name: 'New task' });
}

describe('contextual shell document workflows', () => {
  it.each([
    ['0', 'Contents in Study'],
    ['1', 'Study'],
    ['2', 'Notebooks in Study'],
    ['3', 'Notes and Files in Study'],
    ['4', 'Tasks in Study'],
    ['5', 'Cognitive Tools in Study'],
  ])(
    'labels the exact %s destination after render and repeated navigation without stealing focus',
    async (key, heading) => {
      setup();
      await screen.findByRole('heading', { name: 'Study' });
      const search = screen.getByRole('searchbox', { name: 'Global search' });
      search.focus();
      shortcut(key);
      await within(screen.getByRole('tabpanel')).findByRole('heading', { name: heading });
      const panel = screen.getByRole('tabpanel', { name: heading });
      const focused = vi.fn();
      const blurred = vi.fn();
      panel.addEventListener('focus', focused);
      panel.addEventListener('blur', blurred);
      shortcut(key);
      await waitFor(() =>
        expect(within(screen.getByLabelText('Status bar')).getByRole('status')).not.toBeEmptyDOMElement(),
      );
      expect(screen.getByRole('tabpanel')).toBe(panel);
      expect(search).toHaveFocus();
      expect(focused).not.toHaveBeenCalled();
      expect(blurred).not.toHaveBeenCalled();
    },
  );

  it('does not intercept IME events or shortcuts while a dialog is open', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    shortcut('1', { isComposing: true });
    expect(screen.getByRole('tab', { name: 'Welcome' })).toHaveAttribute('aria-selected', 'true');
    shortcut('2');
    shortcut('n');
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
    shortcut('1');
    expect(screen.getByRole('tab', { name: 'Notebooks' })).toHaveAttribute('aria-selected', 'true');
  });

  it('creates a real library from Libraries and never calls the open-library picker', async () => {
    const { bridge } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    shortcut('1');
    shortcut('n');
    await waitFor(() => expect(bridge.vault.createLibrary).toHaveBeenCalledOnce());
    expect(bridge.vault.open).not.toHaveBeenCalled();
    await within(screen.getByRole('tabpanel')).findByRole('heading', { name: 'New library' });
  });

  it('preserves explicit New notebook shortcut semantics while contextual New uses its customized binding', async () => {
    setup({ settings: { shortcuts: { 'new-contextual': 'Ctrl+Alt+N', 'new-notebook': 'Ctrl+N' } } });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    shortcut('3');
    expect(screen.getByRole('tabpanel', { name: 'Notes and Files in Research' })).toBeInTheDocument();
    shortcut('n');
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    shortcut('n', { altKey: true });
    expect(screen.getByRole('dialog', { name: 'New note' })).toBeInTheDocument();
  });

  it.each(['settings-first', 'library-first'] as const)(
    'preserves notebook context with deferred initialization (%s)',
    async (ordering) => {
      const library = deferred<void>();
      const initialSettings = deferred<NotebookSettings>();
      const librarySettings = deferred<NotebookSettings>();
      const security = deferred<Awaited<ReturnType<NonNullable<NotebookBridge['vault']['getSecurityStatus']>>>>();
      const customized = {
        ...DEFAULT_SETTINGS,
        shortcuts: { 'new-contextual': 'Ctrl+Alt+N', 'new-notebook': 'Ctrl+N' },
      };
      let settingsCalls = 0;
      const { bridge } = setup({
        loadVault: async (vault) => {
          await library.promise;
          return vault;
        },
        loadSettings: () => (++settingsCalls === 1 ? initialSettings.promise : librarySettings.promise),
        getSecurityStatus: () => security.promise,
      });
      expect(screen.queryByRole('treeitem')).not.toBeInTheDocument();
      if (ordering === 'settings-first') await act(async () => initialSettings.resolve(customized));
      await act(async () => library.resolve());
      const notebook = screen.getByRole('treeitem', { name: /Research/ });
      fireEvent.click(notebook);
      shortcut('3');
      expect(screen.getByRole('tabpanel', { name: 'Notes and Files in Research' })).toBeInTheDocument();
      await act(async () => {
        librarySettings.resolve(customized);
        security.resolve({ enabled: false, locked: false, recoveryAvailable: false });
      });
      if (ordering === 'library-first') await act(async () => initialSettings.resolve(DEFAULT_SETTINGS));
      expect(notebook).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Notes and Files in Research' })).toBeInTheDocument();
      const search = screen.getByRole('searchbox', { name: 'Global search' });
      search.focus();
      shortcut('n');
      expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'New Notebook Name' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(search).toHaveFocus();
      shortcut('n', { altKey: true });
      const dialog = screen.getByRole('dialog', { name: 'New note' });
      fireEvent.change(within(dialog).getByLabelText('New Note Name'), { target: { value: 'Deferred' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'New note' }));
      await waitFor(() => expect(bridge.vault.createNote).toHaveBeenCalledWith('Research/Deferred.md'));
      expect(bridge.vault.createNotebook).not.toHaveBeenCalled();
    },
  );

  it('retains a notebook selected on the first library commit before passive startup effects', async () => {
    let selected = false;
    setup({
      settings: { shortcuts: { 'new-contextual': 'Ctrl+Alt+N', 'new-notebook': 'Ctrl+N' } },
      onRender: () => {
        const notebook = screen.queryByRole('treeitem', { name: /Research/ });
        if (notebook && !selected) {
          selected = true;
          // Model interaction after commit but before passive library-reset effects.
          notebook.click();
        }
      },
    });
    await screen.findByRole('heading', { name: 'Study' });
    expect(selected).toBe(true);
    expect(screen.getByRole('treeitem', { name: /Research/ })).toHaveAttribute('aria-selected', 'true');
    shortcut('3');
    expect(screen.getByRole('tabpanel', { name: 'Notes and Files in Research' })).toBeInTheDocument();
    shortcut('n');
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    shortcut('n', { altKey: true });
    expect(screen.getByRole('dialog', { name: 'New note' })).toBeInTheDocument();
  });

  it('keeps contextual New disabled without a notebook after delayed settings load', async () => {
    const settings = deferred<NotebookSettings>();
    setup({ loadSettings: () => settings.promise });
    await screen.findByRole('heading', { name: 'Study' });
    await act(async () =>
      settings.resolve({
        ...DEFAULT_SETTINGS,
        shortcuts: { 'new-contextual': 'Ctrl+Alt+N', 'new-notebook': 'Ctrl+N' },
      }),
    );
    shortcut('3');
    expect(screen.getByRole('tabpanel', { name: 'Notes and Files in Study' })).toBeInTheDocument();
    shortcut('n', { altKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    shortcut('n');
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
  });

  it('can disable contextual New without moving its default binding to another command', async () => {
    setup({ settings: { shortcuts: { 'new-contextual': '' } } });
    await screen.findByRole('heading', { name: 'Study' });
    shortcut('3');
    shortcut('n');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses notebook context for New note independently of the current file selection', async () => {
    const { bridge } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    shortcut('3');
    fireEvent.click(screen.getByRole('gridcell', { name: 'Plan.md' }));
    shortcut('n');
    const dialog = screen.getByRole('dialog', { name: 'New note' });
    fireEvent.change(within(dialog).getByLabelText('New Note Name'), { target: { value: 'Next' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New note' }));
    await waitFor(() => expect(bridge.vault.createNote).toHaveBeenCalledWith('Research/Next.md'));
  });

  it.each(['md', 'html'])(
    'persists a real %s task with stable identity, due date, priority and associated note',
    async (format) => {
      const { bridge } = setup();
      await screen.findByRole('heading', { name: 'Study' });
      const dialog = newAssociatedTask();
      await within(dialog).findByRole('option', { name: `Research/Plan.${format}` });
      fireEvent.change(within(dialog).getByLabelText('Associated note'), {
        target: { value: `Research/Plan.${format}` },
      });
      fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Prepare <review>' } });
      fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2026-11-01' } });
      fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'high' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
      await waitFor(() => expect(bridge.vault.saveNote).toHaveBeenCalledOnce());
      const [path, content] = bridge.vault.saveNote.mock.calls[0];
      const parsed = format === 'html' ? parseHtmlTasks(content, path) : parseMarkdownTasks(content, path);
      expect(parsed).toEqual([
        expect.objectContaining({
          path: `Research/Plan.${format}`,
          text: 'Prepare <review>',
          dueDate: '2026-11-01',
          priority: 'high',
          complete: false,
          taskId: expect.any(String),
        }),
      ]);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('tabpanel')).toHaveFocus();
    },
  );

  it('never overwrites an unsaved associated note when creating a task', async () => {
    const { bridge } = setup({ mode: 'edit' });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    fireEvent.click(screen.getByRole('treeitem', { name: /Plan\.md/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Markdown source' }), {
      target: { value: '# Unsaved' },
    });
    const dialog = newAssociatedTask();
    await within(dialog).findByRole('option', { name: 'Research/Plan.md' });
    fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Do not overwrite' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save or resolve note changes');
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
  });

  it('keeps protected notes out of persisted task creation without exposing their content', async () => {
    const { bridge } = setup();
    bridge.vault.isNoteEncrypted.mockResolvedValue(true);
    await screen.findByRole('heading', { name: 'Study' });
    const dialog = newAssociatedTask();
    await within(dialog).findByText('Create an unencrypted managed note before adding a task.');
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled();
    expect(within(within(dialog).getByLabelText('Associated note')).getAllByRole('option')).toHaveLength(1);
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
  });

  it('offers only managed, unencrypted, ordinary notes as task associations', async () => {
    const { bridge } = setup({
      entries: [
        { name: 'Allowed.md', path: 'Allowed.md', kind: 'note', provenance: 'created' },
        { name: 'Secret.html', path: 'Secret.html', kind: 'note', provenance: 'imported' },
        { name: 'External.md', path: 'External.md', kind: 'note', provenance: 'unknown' },
        { name: 'Map.outline.md', path: 'Map.outline.md', kind: 'note', provenance: 'created' },
        { name: 'Deck.cards.md', path: 'Deck.cards.md', kind: 'note', provenance: 'imported' },
      ],
    });
    bridge.vault.isNoteEncrypted.mockImplementation(async (path) => path === 'Secret.html');
    await screen.findByRole('heading', { name: 'Study' });
    const dialog = newAssociatedTask();
    await within(dialog).findByRole('option', { name: 'Allowed.md' });
    const options = within(within(dialog).getByLabelText('Associated note')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Allowed.md']);
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
  });

  it('does not offer to retry a task that was saved when refreshing the task list fails', async () => {
    const { bridge } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    bridge.vault.getTasks.mockRejectedValueOnce(new Error('Refresh unavailable'));
    const dialog = newAssociatedTask();
    await within(dialog).findByRole('option', { name: 'Research/Plan.md' });
    fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Persist once' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.vault.saveNote).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Task created. Refresh Tasks');
  });

  it('discards an in-flight note read when the library locks', async () => {
    const { bridge } = setup({ mode: 'edit' });
    await screen.findByRole('heading', { name: 'Study' });
    let resolveRead!: (source: string) => void;
    bridge.vault.readNote.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    fireEvent.click(screen.getByRole('treeitem', { name: /Plan\.md/ }));
    await act(async () => {
      bridge.vault.onSecurityLocked.mock.calls[0][0]();
      resolveRead('# Must not appear');
    });
    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
    expect(screen.queryByText('Must not appear')).not.toBeInTheDocument();
  });

  it('offers every supported cognitive tool type and focuses its chooser for New', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    shortcut('5');
    shortcut('n');
    const chooser = screen.getByRole('combobox', { name: 'New asset type' });
    await waitFor(() => expect(chooser).toHaveFocus());
    expect(
      within(chooser)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(['outline', 'mindmap', 'flashcards', 'grid', 'markdown-grid']);
  });

  it.each([
    ['outline', '.outline.md', '- First item\n'],
    ['mindmap', '.mindmap.json', '{"id":"root","text":"Main idea","children":[]}\n'],
    ['flashcards', '.cards.md', 'Question :: Answer\n'],
    ['grid', '.csv', 'Column 1,Column 2\n,\n'],
    ['markdown-grid', '.grid.md', '| Column 1 | Column 2 |\n| --- | --- |\n| | |\n'],
  ])('creates and opens a complete %s asset', async (type, extension, content) => {
    const { bridge } = setup();
    bridge.vault.createAsset.mockResolvedValue({ name: 'Study', path: '/study', entries: [] });
    bridge.vault.readAsset.mockResolvedValue({ path: `New${extension}`, type, content });
    await screen.findByRole('heading', { name: 'Study' });
    shortcut('5');
    shortcut('n');
    fireEvent.change(screen.getByRole('combobox', { name: 'New asset type' }), { target: { value: type } });
    fireEvent.change(screen.getByRole('textbox', { name: 'New asset name' }), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(bridge.vault.createAsset).toHaveBeenCalledWith(`New${extension}`, content));
    await waitFor(() => expect(bridge.vault.readAsset).toHaveBeenCalledWith(`New${extension}`));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves dirty cognitive changes and disables New until they are saved or discarded', async () => {
    const { bridge } = setup({
      entries: [{ name: 'Map.outline.md', path: 'Map.outline.md', kind: 'attachment', provenance: 'created' }],
    });
    bridge.vault.readAsset.mockResolvedValue({ path: 'Map.outline.md', type: 'outline', content: '- First item\n' });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Map\.outline\.md/ }));
    const input = await screen.findByRole('textbox', { name: /Item text/ });
    fireEvent.change(input, { target: { value: 'Unsaved idea' } });
    const panel = screen.getByRole('tabpanel');
    panel.focus();
    const focused = vi.fn();
    panel.addEventListener('focus', focused);
    shortcut('5');
    expect(focused).not.toHaveBeenCalled();
    expect(screen.getByRole('tabpanel')).toBe(panel);
    expect(screen.getByRole('textbox', { name: /Item text/ })).toBe(input);
    expect(input).toHaveValue('Unsaved idea');
    expect(bridge.vault.readAsset).toHaveBeenCalledOnce();
    shortcut('n');
    expect(input).toHaveValue('Unsaved idea');
    expect(screen.getByRole('combobox', { name: 'New asset type' })).toBeDisabled();
    expect(bridge.vault.createAsset).not.toHaveBeenCalled();
  });

  it('reapplies the reading preference on tab activation without discarding unsaved note edits', async () => {
    const { bridge } = setup({ mode: 'read', settings: { autosaveDelay: 0 } });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    fireEvent.click(screen.getByRole('treeitem', { name: /Plan\.md/ }));
    await screen.findByRole('heading', { name: 'Plan', level: 2 });
    shortcut('e');
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown source' }), { target: { value: '# Unsaved work' } });
    shortcut('3');
    fireEvent.click(screen.getByRole('tab', { name: 'Plan (unsaved)' }));
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Unsaved work' })).toBeInTheDocument();
    shortcut('e');
    expect(screen.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Unsaved work');
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
  });

  it.each(['read', 'edit'] as const)('uses the %s preference on open, tab switch and repeated open', async (mode) => {
    const { bridge } = setup({ mode });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    const entry = screen.getByRole('treeitem', { name: /Plan\.md/ });
    fireEvent.click(entry);
    await screen.findByRole('heading', { name: 'Plan', level: 2 });
    const check = () => expect(!!screen.queryByRole('textbox', { name: 'Markdown source' })).toBe(mode === 'edit');
    await waitFor(check);
    shortcut('e');
    shortcut('3');
    fireEvent.click(within(screen.getByRole('tablist')).getByRole('tab', { name: 'Plan' }));
    await waitFor(check);
    await act(async () => {
      fireEvent.click(entry);
    });
    await waitFor(check);
    expect(bridge.vault.readNote).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close Plan' }));
    // Closing the open note returns to the Notes and Files grid, focused on
    // the closed note's cell.
    await waitFor(() =>
      expect(
        within(screen.getByRole('grid', { name: 'Notes and files' })).getByRole('gridcell', { name: 'Plan.md' }),
      ).toHaveFocus(),
    );
    fireEvent.click(entry);
    await screen.findByRole('heading', { name: 'Plan', level: 2 });
    await waitFor(check);
    await waitFor(() => expect(bridge.vault.readNote).toHaveBeenCalledTimes(2));
  });

  it('routes unknown and missing-provenance Markdown and assets through Open With without reading them', async () => {
    const { bridge } = setup({
      entries: [
        { name: 'External.md', path: 'External.md', kind: 'note', provenance: 'unknown' },
        { name: 'External.outline.md', path: 'External.outline.md', kind: 'attachment' },
      ],
    });
    await screen.findByRole('heading', { name: 'Study' });
    for (const path of ['External.md', 'External.outline.md']) {
      fireEvent.click(screen.getByRole('treeitem', { name: new RegExp(`^${path.replaceAll('.', '\\.')}`) }));
      const dialog = await screen.findByRole('dialog', { name: 'Open external file' });
      fireEvent.click(within(dialog).getByRole('button', { name: /Open with/i }));
      await waitFor(() => expect(bridge.vault.openWith).toHaveBeenCalledWith(path));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(bridge.vault.readAsset).not.toHaveBeenCalled();
    shortcut('5');
    expect(within(screen.getByRole('combobox', { name: 'Asset file' })).getAllByRole('option')).toHaveLength(1);
  });

  it('authenticates legacy encrypted recovery before reading or internally opening its note', async () => {
    const path = 'Legacy.md';
    const { bridge, vault } = setup({ entries: [{ name: path, path, kind: 'note' }] });
    bridge.vault.isNoteEncrypted.mockResolvedValue(true);
    let resolveAdoption!: (value: VaultInfo | null) => void;
    bridge.vault.adoptEncrypted.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdoption = resolve;
        }),
    );
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Legacy\.md/ }));
    await waitFor(() => expect(bridge.vault.adoptEncrypted).toHaveBeenCalledWith(path, undefined));
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'Legacy' })).not.toBeInTheDocument();
    await act(async () =>
      resolveAdoption({ ...vault, entries: [{ name: path, path, kind: 'note', provenance: 'imported' }] }),
    );
    await screen.findByRole('tab', { name: 'Legacy' });
    expect(bridge.vault.readNote).toHaveBeenCalledWith(path, undefined);
    expect(bridge.vault.openWith).not.toHaveBeenCalled();
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
  });

  it('leaves legacy ciphertext unopened when native recovery consent is cancelled', async () => {
    const { bridge } = setup({ entries: [{ name: 'Legacy.md', path: 'Legacy.md', kind: 'note' }] });
    bridge.vault.isNoteEncrypted.mockResolvedValue(true);
    bridge.vault.adoptEncrypted.mockResolvedValue(null);
    await screen.findByRole('heading', { name: 'Study' });
    await act(async () => {
      fireEvent.click(screen.getByRole('treeitem', { name: /Legacy\.md/ }));
    });
    expect(bridge.vault.adoptEncrypted).toHaveBeenCalledOnce();
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(bridge.vault.openWith).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'Legacy' })).not.toBeInTheDocument();
  });

  it('uses the existing note-password dialog for authenticated legacy recovery', async () => {
    const path = 'Legacy.md';
    const { bridge, vault } = setup({ entries: [{ name: path, path, kind: 'note' }] });
    bridge.vault.isNoteEncrypted.mockResolvedValue(true);
    bridge.vault.adoptEncrypted.mockRejectedValueOnce(new Error('Enter this note’s password to recover it.'));
    bridge.vault.adoptEncrypted.mockResolvedValueOnce({
      ...vault,
      entries: [{ name: path, path, kind: 'note', provenance: 'imported' }],
    });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Legacy\.md/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Unlock encrypted note' });
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Note password'), { target: { value: 'local-test-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock note' }));
    await screen.findByRole('tab', { name: 'Legacy' });
    expect(bridge.vault.adoptEncrypted).toHaveBeenLastCalledWith(path, 'local-test-password');
    expect(bridge.vault.readNote).toHaveBeenCalledWith(path, 'local-test-password');
  });

  it('does not read a legacy note if recovery fails to establish managed provenance', async () => {
    const { bridge, vault } = setup({ entries: [{ name: 'Legacy.md', path: 'Legacy.md', kind: 'note' }] });
    bridge.vault.isNoteEncrypted.mockResolvedValue(true);
    bridge.vault.adoptEncrypted.mockResolvedValue(vault);
    await screen.findByRole('heading', { name: 'Study' });
    await act(async () => {
      fireEvent.click(screen.getByRole('treeitem', { name: /Legacy\.md/ }));
    });
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'Legacy' })).not.toBeInTheDocument();
  });

  it('ignores authenticated recovery completion after the library locks', async () => {
    const path = 'Legacy.md';
    const { bridge, vault } = setup({ entries: [{ name: path, path, kind: 'note' }] });
    bridge.vault.isNoteEncrypted.mockResolvedValue(true);
    let resolveAdoption!: (value: VaultInfo | null) => void;
    bridge.vault.adoptEncrypted.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdoption = resolve;
        }),
    );
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Legacy\.md/ }));
    await waitFor(() => expect(bridge.vault.adoptEncrypted).toHaveBeenCalledOnce());
    await act(async () => {
      bridge.vault.onSecurityLocked.mock.calls[0][0]();
      resolveAdoption({ ...vault, entries: [{ name: path, path, kind: 'note', provenance: 'imported' }] });
    });
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'Legacy' })).not.toBeInTheDocument();
  });

  it('offers explicit Open With and Windows default application context actions', async () => {
    const { bridge } = setup({
      entries: [{ name: 'External.md', path: 'External.md', kind: 'attachment', provenance: 'unknown' }],
    });
    await screen.findByRole('heading', { name: 'Study' });
    const entry = screen.getByRole('treeitem', { name: /External\.md/ });
    fireEvent.contextMenu(entry);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open With…' }));
    await waitFor(() => expect(bridge.vault.openWith).toHaveBeenCalledWith('External.md', { makeDefault: false }));
    fireEvent.contextMenu(entry);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose default application…' }));
    await waitFor(() => expect(bridge.vault.openWith).toHaveBeenCalledWith('External.md', { makeDefault: true }));
  });

  it('keeps non-note views read-only even when the default note preference is Edit', async () => {
    setup({ mode: 'edit' });
    await screen.findByRole('heading', { name: 'Study' });
    for (const key of ['0', '1', '2', '3', '4', '5']) {
      shortcut(key);
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('Mode: read-only');
    }
    shortcut('e');
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('no note editor');
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Mode: read-only');
  });

  it.each(['pdf', 'docx', 'txt'])(
    'never offers an editor for managed %s previews under default Edit',
    async (extension) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise(() => {})),
      );
      const path = `Guide.${extension}`;
      const { bridge } = setup({
        mode: 'edit',
        entries: [{ name: path, path, kind: 'attachment', provenance: 'imported' }],
      });
      bridge.vault.readAttachment.mockResolvedValue({ path, kind: `.${extension}`, text: 'Read-only preview' });
      await screen.findByRole('heading', { name: 'Study' });
      fireEvent.click(screen.getByRole('treeitem', { name: new RegExp(`Guide\\.${extension}`) }));
      await screen.findByRole('tab', { name: path });
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('Mode: read-only');
      shortcut('e');
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('no note editor');
      expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'HTML source' })).not.toBeInTheDocument();
    },
  );

  it('keeps the tab panel labelled when note paths contain spaces and punctuation', async () => {
    setup({ entries: [{ name: 'A plan #1.md', path: 'A plan #1.md', kind: 'note', provenance: 'created' }] });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('treeitem', { name: /A plan #1\.md/ }));
    const panel = await screen.findByRole('tabpanel', { name: 'A plan #1' });
    expect(screen.getByRole('tab', { name: 'A plan #1' })).toHaveAttribute('aria-controls', panel.id);
  });

  it('imports a compatible selected document before opening its managed copy', async () => {
    const { bridge, vault } = setup({
      entries: [{ name: 'External.md', path: 'External.md', kind: 'attachment', provenance: 'unknown' }],
    });
    bridge.vault.importEntry.mockResolvedValue({
      vault: {
        ...vault,
        entries: [...vault.entries, { name: 'Imported.md', path: 'Imported.md', kind: 'note', provenance: 'imported' }],
      },
      path: 'Imported.md',
    });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /External\.md/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into A11y Notebook…' }));
    await waitFor(() => expect(bridge.vault.importEntry).toHaveBeenCalledWith('External.md'));
    await waitFor(() => expect(bridge.vault.readNote).toHaveBeenCalledWith('Imported.md', undefined));
    expect(bridge.vault.openWith).not.toHaveBeenCalled();
    expect(screen.getByRole('treeitem', { name: /External\.md/ })).toBeInTheDocument();
  });

  it('does not offer import for incompatible files or try to read their bytes', async () => {
    const { bridge } = setup({
      entries: [{ name: 'Program.exe', path: 'Program.exe', kind: 'attachment', provenance: 'unknown' }],
    });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /Program\.exe/ }));
    expect(screen.queryByRole('menuitem', { name: 'Import into A11y Notebook…' })).not.toBeInTheDocument();
    expect(bridge.vault.importEntry).not.toHaveBeenCalled();
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
  });
});
