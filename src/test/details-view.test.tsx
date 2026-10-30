import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import DetailsView from '../renderer/components/DetailsView';
import NotebooksScreen from '../renderer/features/screens/NotebooksScreen';
import NotesFilesScreen from '../renderer/features/screens/NotesFilesScreen';
import VaultTree from '../renderer/features/vault/VaultTree';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultEntry, VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

const items: VaultEntry[] = [
  { name: 'Beta.md', path: 'Research/Beta.md', kind: 'note' },
  { name: 'Report.pdf', path: 'Research/Report.pdf', kind: 'attachment' },
  { name: 'Alpha.md', path: 'Research/Alpha.md', kind: 'note' },
];

function renderDetails(overrides: Partial<ComponentProps<typeof DetailsView>> = {}) {
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const onContextMenu = vi.fn();
  render(
    <DetailsView
      label="Notebook items"
      items={items}
      selectedPath={null}
      onSelect={onSelect}
      onOpen={onOpen}
      onRename={onRename}
      onDelete={onDelete}
      onContextMenu={onContextMenu}
      {...overrides}
    />,
  );
  return { onSelect, onOpen, onRename, onDelete, onContextMenu };
}

function renderLibrary() {
  const vault: VaultInfo = {
    name: 'Study',
    path: 'C:/Study',
    entries: [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [
          { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' },
          { name: 'Report.txt', path: 'Research/Report.txt', kind: 'note', provenance: 'imported' },
        ],
      },
      {
        name: 'Archive',
        path: 'Archive',
        kind: 'notebook',
        children: [{ name: 'Archived.md', path: 'Archive/Archived.md', kind: 'note', provenance: 'created' }],
      },
      { name: 'Root.md', path: 'Root.md', kind: 'note', provenance: 'created' },
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
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Idea'),
      readAttachment: vi.fn(async () => ({ path: 'Research/Report.txt', text: 'Report', kind: 'text' })),
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

function navigate(shortcut: string) {
  fireEvent.keyDown(document, { key: shortcut, ctrlKey: true });
}

function expectResearchContext() {
  expect(screen.getByText('Items in Research')).toBeInTheDocument();
  const grid = screen.getByRole('grid', { name: 'Notes and files' });
  expect(within(grid).getByRole('gridcell', { name: 'Idea.md' })).toBeInTheDocument();
  expect(within(grid).getByRole('gridcell', { name: 'Report.txt' })).toBeInTheDocument();
  expect(within(grid).queryByRole('gridcell', { name: 'Archived.md' })).not.toBeInTheDocument();
  expect(within(grid).queryByRole('gridcell', { name: 'Root.md' })).not.toBeInTheDocument();
}

describe('accessible details view', () => {
  it('exposes a labelled grid and supports arrow, Home/End, and Ctrl+Home/Ctrl+End navigation', () => {
    renderDetails();
    const grid = screen.getByRole('grid', { name: 'Notebook items' });
    const alpha = within(grid).getByRole('gridcell', { name: 'Alpha.md' });
    const beta = within(grid).getByRole('gridcell', { name: 'Beta.md' });
    const betaType = within(screen.getByRole('row', { name: /Beta\.md/ })).getByRole('gridcell', { name: 'note' });
    const reportType = within(grid).getByRole('gridcell', { name: 'attachment' });

    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowDown' });
    expect(beta).toHaveFocus();
    fireEvent.keyDown(beta, { key: 'ArrowRight' });
    expect(betaType).toHaveFocus();
    fireEvent.keyDown(betaType, { key: 'Home' });
    expect(beta).toHaveFocus();
    fireEvent.keyDown(beta, { key: 'End' });
    expect(betaType).toHaveFocus();
    fireEvent.keyDown(betaType, { key: 'Home', ctrlKey: true });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(alpha, { key: 'End', ctrlKey: true });
    expect(reportType).toHaveFocus();
  });

  it('keeps one tab stop and includes sortable headers in grid keyboard navigation', () => {
    renderDetails();
    const grid = screen.getByRole('grid', { name: 'Notebook items' });
    const alpha = within(grid).getByRole('gridcell', { name: 'Alpha.md' });
    const name = within(grid).getByRole('columnheader', { name: 'Name' });
    const type = within(grid).getByRole('columnheader', { name: 'Type' });

    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowUp' });
    expect(name).toHaveFocus();
    fireEvent.keyDown(name, { key: 'ArrowRight' });
    expect(type).toHaveFocus();
    fireEvent.keyDown(type, { key: 'ArrowDown' });
    expect(within(screen.getAllByRole('row')[1]).getByRole('gridcell', { name: 'note' })).toHaveFocus();
    fireEvent.keyDown(within(screen.getAllByRole('row')[1]).getByRole('gridcell', { name: 'note' }), {
      key: 'ArrowUp',
    });
    expect(type).toHaveFocus();
    fireEvent.keyDown(type, { key: ' ' });
    expect(type).toHaveAttribute('aria-sort', 'ascending');
    expect(
      within(grid)
        .getAllByRole('button')
        .every((button) => button.tabIndex === -1),
    ).toBe(true);
  });

  it('sorts by name and retains selection by stable item identity', () => {
    renderDetails({ selectedPath: 'Research/Beta.md' });
    const grid = screen.getByRole('grid', { name: 'Notebook items' });
    const nameHeader = within(grid).getByRole('button', { name: 'Name' });
    const rowNames = () =>
      within(grid)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('gridcell')[0].textContent);

    expect(rowNames()).toEqual(['Alpha.md', 'Beta.md', 'Report.pdf']);
    nameHeader.focus();
    fireEvent.click(nameHeader);
    expect(rowNames()).toEqual(['Report.pdf', 'Beta.md', 'Alpha.md']);
    expect(nameHeader).toHaveFocus();
    expect(within(grid).getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending');
    expect(within(grid).getAllByRole('row')[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('activates, renames, selects with Space, and opens pointer and keyboard context menus', () => {
    const { onSelect, onOpen, onRename, onContextMenu } = renderDetails();
    const alpha = screen.getByRole('gridcell', { name: 'Alpha.md' });

    fireEvent.click(alpha);
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(alpha, { key: ' ' });
    fireEvent.keyDown(alpha, { key: 'Enter' });
    fireEvent.keyDown(alpha, { key: 'F2' });
    fireEvent.contextMenu(alpha, { clientX: 12, clientY: 24 });
    fireEvent.keyDown(alpha, { key: 'ContextMenu' });
    fireEvent.keyDown(alpha, { key: 'F10', shiftKey: true });

    expect(onSelect).toHaveBeenCalledWith(items[2]);
    expect(onOpen).toHaveBeenCalledWith(items[2]);
    expect(onRename).toHaveBeenCalledWith(items[2]);
    expect(onContextMenu).toHaveBeenCalledTimes(3);
    expect(onContextMenu.mock.calls[0][0]).toEqual(items[2]);
    expect(onContextMenu.mock.calls[0][2]).toEqual({ x: 12, y: 24 });
    expect(onContextMenu.mock.calls[1][0]).toEqual(items[2]);
    expect(onContextMenu.mock.calls[2][0]).toEqual(items[2]);
  });

  it('deletes the focused item with the Delete key', () => {
    const { onDelete } = renderDetails();
    const alpha = screen.getByRole('gridcell', { name: 'Alpha.md' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(items[2]);
  });

  it('routes Shift+Delete to the permanent handler, not the trash handler', () => {
    const onDelete = vi.fn();
    const onDeletePermanent = vi.fn();
    renderDetails({ onDelete, onDeletePermanent });
    const alpha = screen.getByRole('gridcell', { name: 'Alpha.md' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'Delete', shiftKey: true });
    expect(onDeletePermanent).toHaveBeenCalledTimes(1);
    expect(onDeletePermanent).toHaveBeenCalledWith(items[2]);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('moves focus to a nearby item if the focused identity is removed', () => {
    const { rerender } = render(
      <DetailsView label="Notebook items" items={items} selectedPath={null} onSelect={vi.fn()} onOpen={vi.fn()} />,
    );
    const beta = screen.getByRole('gridcell', { name: 'Beta.md' });
    beta.focus();
    rerender(
      <DetailsView
        label="Notebook items"
        items={items.filter((item) => item.path !== 'Research/Beta.md')}
        selectedPath={null}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('gridcell', { name: 'Report.pdf' })).toHaveFocus();
  });

  it('recovers tree focus after removal without stealing focus from another view', () => {
    const entries: VaultEntry[] = [
      { name: 'Research', path: 'Research', kind: 'notebook' },
      { name: 'Archive', path: 'Archive', kind: 'notebook' },
    ];
    const props = {
      selectedPath: null,
      onSelect: vi.fn(),
      onOpen: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(
      <>
        <button>Other view</button>
        <VaultTree {...props} entries={entries} />
      </>,
    );
    act(() => screen.getByRole('treeitem', { name: /Research/ }).focus());
    rerender(
      <>
        <button>Other view</button>
        <VaultTree {...props} entries={entries.slice(1)} />
      </>,
    );
    expect(screen.getByRole('treeitem', { name: /Archive/ })).toHaveFocus();
    const otherView = screen.getByRole('button', { name: 'Other view' });
    act(() => otherView.focus());
    props.onSelect.mockClear();
    rerender(
      <>
        <button>Other view</button>
        <VaultTree {...props} entries={entries.slice(0, 1)} />
      </>,
    );
    expect(otherView).toHaveFocus();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('wires notebook and notes/files screens to filtered detail grids', () => {
    const entries: VaultEntry[] = [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note' }],
      },
      { name: 'Archive', path: 'Archive', kind: 'notebook' },
    ];
    const screenProps = {
      entries,
      hasLibrary: true,
      selectedPath: null,
      onSelect: vi.fn(),
      onOpen: vi.fn(),
    };
    const { rerender } = render(<NotebooksScreen {...screenProps} />);
    expect(screen.getByRole('grid', { name: 'Notebooks' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Research' })).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Idea.md' })).not.toBeInTheDocument();

    rerender(<NotesFilesScreen {...screenProps} notebookPath="Research" />);
    expect(screen.getByRole('grid', { name: 'Notes and files' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Idea.md' })).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('shows nothing in notes and files until a notebook is selected (notebook silo)', () => {
    const entries: VaultEntry[] = [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note' }],
      },
      {
        name: 'Archive',
        path: 'Archive',
        kind: 'notebook',
        children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note' }],
      },
      { name: 'Root.md', path: 'Root.md', kind: 'note' },
    ];
    const screenProps = {
      entries,
      hasLibrary: true,
      selectedPath: null,
      onSelect: vi.fn(),
      onOpen: vi.fn(),
    };
    render(<NotesFilesScreen {...screenProps} notebookPath={undefined} />);
    expect(screen.getByRole('grid', { name: 'Notes and files' })).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Idea.md' })).not.toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Old.md' })).not.toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Root.md' })).not.toBeInTheDocument();
    expect(screen.getByText(/Select a notebook to see its notes and files/)).toBeInTheDocument();
  });

  it('searches the whole library by default and announces the scope', async () => {
    window.localStorage.clear();
    const { bridge } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    expect(screen.getByRole('radio', { name: 'Whole library' })).toBeChecked();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Global search' }), { target: { value: 'Idea' } });
    await waitFor(() => expect(bridge.vault.search).toHaveBeenCalledWith({ text: 'Idea', limit: 100 }));
    expect(await screen.findByText(/0 results shown \(up to 100\) in Whole library\./)).toBeInTheDocument();
  });

  it('puts the search box first in the header with scope controls right after it', async () => {
    window.localStorage.clear();
    renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    const searchbox = screen.getByRole('searchbox', { name: 'Global search' });
    const header = searchbox.closest('header');
    expect(header?.firstElementChild).toContainElement(searchbox);
    const scope = screen.getByRole('group', { name: 'Search scope' });
    expect(searchbox.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the scope controls right after the search box even with no library open', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
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
        get: vi.fn(async () => null),
        getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
        getTasks: vi.fn(async () => []),
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
        isNoteEncrypted: vi.fn(async () => false),
        onSecurityLocked: vi.fn(() => () => undefined),
      },
      onMenuCommand: vi.fn(() => () => undefined),
    } as unknown as NotebookBridge;
    window.a11yNotebook = bridge;
    render(<App />);
    const searchbox = await screen.findByRole('searchbox', { name: 'Global search' });
    const scope = screen.getByRole('group', { name: 'Search scope' });
    expect(searchbox.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Current notebook (none selected)' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Whole library' })).toBeDisabled();
  });

  it('keeps the open tabs outside the main landmark', async () => {
    window.localStorage.clear();
    renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    const main = screen.getByRole('main', { name: 'Main content' });
    expect(main).toContainElement(screen.getByRole('tabpanel'));
    expect(main).not.toContainElement(screen.getByRole('tablist', { name: 'Open tabs' }));
  });

  it('searches only the selected notebook in current-notebook scope and remembers the scope', async () => {
    window.localStorage.clear();
    const { bridge } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    navigate('2');
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    expectResearchContext();
    fireEvent.click(screen.getByRole('radio', { name: 'Current notebook: Research' }));
    expect(window.localStorage.getItem('a11y-notebook.search-scope')).toBe('current');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Global search' }), { target: { value: 'Idea' } });
    await waitFor(() =>
      expect(bridge.vault.search).toHaveBeenCalledWith({ text: 'Idea', notebook: 'Research', limit: 100 }),
    );
    expect(
      await screen.findByText(/0 results shown \(up to 100\) in Current notebook: Research\./),
    ).toBeInTheDocument();
  });

  it('backs up the library from the File menu and announces the result', async () => {
    window.localStorage.clear();
    const { bridge } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    const backup = vi.fn(async () => ({ cancelled: false, path: 'C:/Backups/Study backup', files: 3, bytes: 42 }));
    (bridge.vault as unknown as { backupLibrary: unknown }).backupLibrary = backup;
    fireEvent.click(screen.getByRole('button', { name: 'Back up library' }));
    await waitFor(() => expect(backup).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getAllByText(/Library backup complete: 3 files copied to C:\/Backups\/Study backup\./).length,
      ).toBeGreaterThan(0),
    );
  });

  it('does not search the whole library when current-notebook scope has no notebook selected', async () => {
    window.localStorage.clear();
    const { bridge } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    fireEvent.click(screen.getByRole('radio', { name: 'Current notebook (none selected)' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Global search' }), { target: { value: 'Idea' } });
    await waitFor(() =>
      expect(
        screen.getAllByText('Select a notebook to search it, or switch search scope to Whole library.').length,
      ).toBeGreaterThan(0),
    );
    expect(bridge.vault.search).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'Idea.md', path: 'Research/Idea.md', heading: 'Idea' },
    { name: 'Report.txt', path: 'Research/Report.txt', heading: 'Report' },
  ])('preserves notebook context when selecting and opening $name', async ({ name, path, heading }) => {
    const { bridge, menu } = renderLibrary();

    await screen.findByRole('heading', { name: 'Study', level: 2 });
    menu('show-contents');
    expect(screen.getByRole('heading', { name: 'Contents in Study' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Libraries (1)' }));
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Study' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Open library' })).toBeInTheDocument();

    menu('show-notebooks');
    const notebooks = screen.getByRole('grid', { name: 'Notebooks' });
    const research = within(notebooks).getByRole('gridcell', { name: 'Research' });
    fireEvent.keyDown(research, { key: 'ContextMenu' });
    const contextMenu = screen.getByRole('menu', { name: 'Actions for Research' });
    fireEvent.keyDown(contextMenu, { key: 'Escape' });
    expect(research).toHaveFocus();
    fireEvent.keyDown(research, { key: 'Enter' });

    const notesFiles = await screen.findByRole('grid', { name: 'Notes and files' });
    expectResearchContext();
    const item = within(notesFiles).getByRole('gridcell', { name });
    item.focus();
    fireEvent.keyDown(item, { key: ' ' });
    expectResearchContext();
    expect(item.closest('[role="row"]')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    expect(bridge.vault.readNote).toHaveBeenCalledWith(path, undefined);

    navigate('3');
    expectResearchContext();
    menu('refresh-links');
    await waitFor(() => expect(bridge.vault.get).toHaveBeenCalledTimes(2));
    expectResearchContext();
    navigate('0');
    expect(screen.getByRole('heading', { name: 'Contents in Study' })).toBeInTheDocument();
    navigate('1');
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Study' })).toBeInTheDocument();
    navigate('2');
    expect(screen.getByRole('heading', { name: 'Notebooks in Study' })).toBeInTheDocument();
    navigate('3');
    expectResearchContext();
    fireEvent.keyDown(document, { key: 'p', ctrlKey: true, shiftKey: true });
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByRole('searchbox', { name: 'Search Command Palette' })).toHaveFocus();
    fireEvent.change(within(palette).getByRole('searchbox'), { target: { value: 'show-notes-files' } });
    fireEvent.click(within(palette).getByRole('button', { name: 'Notes & Files' }));
    expectResearchContext();

    navigate('2');
    const archive = screen.getByRole('gridcell', { name: 'Archive' });
    archive.focus();
    fireEvent.keyDown(archive, { key: ' ' });
    navigate('3');
    expect(screen.getByText('Items in Archive')).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Archived.md' })).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Idea.md' })).not.toBeInTheDocument();
  });

  it('moves back and forward through browsing history with Alt+Arrow keys', async () => {
    renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });

    // At the start of history there is nowhere to go back to.
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    expect(screen.getAllByText('Nothing to go back to.').length).toBeGreaterThan(0);

    navigate('2');
    expect(screen.getByRole('heading', { name: 'Notebooks in Study' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    expectResearchContext();

    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    expect(screen.getByRole('heading', { name: 'Notebooks in Study' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
    expectResearchContext();

    // A fresh navigation after going back truncates the forward stack.
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    expect(screen.getByRole('heading', { name: 'Notebooks in Study' })).toBeInTheDocument();
    navigate('0');
    expect(screen.getByRole('heading', { name: 'Contents in Study' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
    expect(screen.getAllByText('Nothing to go forward to.').length).toBeGreaterThan(0);
  });

  it.each([
    { action: 'rename', cancelled: false, watcherRefresh: false },
    { action: 'move', cancelled: false, watcherRefresh: false },
    { action: 'rename', cancelled: true, watcherRefresh: false },
    { action: 'move', cancelled: true, watcherRefresh: false },
    { action: 'rename', cancelled: false, watcherRefresh: true },
    { action: 'move', cancelled: false, watcherRefresh: true },
  ] as const)(
    'updates notebook context after $action (cancelled: $cancelled, watcher refresh: $watcherRefresh)',
    async ({ action, cancelled, watcherRefresh }) => {
      const { vault, bridge } = renderLibrary();
      await screen.findByRole('heading', { name: 'Study', level: 2 });
      navigate('2');
      const research = screen.getByRole('gridcell', { name: 'Research' });
      research.focus();
      const destination = action === 'rename' ? 'Renamed' : 'Archive/Research';
      const remap = (entry: VaultEntry): VaultEntry => ({
        ...entry,
        path: entry.path.replace(/^Research/, destination),
        name: entry.path === 'Research' && action === 'rename' ? 'Renamed' : entry.name,
        children: entry.children?.map(remap),
      });
      const researchEntry = remap(vault.entries[0]);
      const updated: VaultInfo = {
        ...vault,
        entries: [
          ...(action === 'rename' ? [researchEntry] : []),
          {
            ...vault.entries[1],
            children: [...(vault.entries[1].children ?? []), ...(action === 'move' ? [researchEntry] : [])],
          },
          vault.entries[2],
        ],
      };
      vi.mocked(bridge.vault.rename).mockResolvedValue(cancelled ? vault : updated);
      vi.mocked(bridge.vault.move).mockResolvedValue(cancelled ? vault : updated);
      let finishRelocation!: (value: VaultInfo) => void;
      if (watcherRefresh)
        vi.mocked(bridge.vault[action]).mockReturnValue(
          new Promise<VaultInfo>((resolve) => {
            finishRelocation = resolve;
          }),
        );
      if (action === 'rename') {
        fireEvent.keyDown(research, { key: 'F2' });
        fireEvent.change(screen.getByRole('textbox', { name: 'New Name' }), { target: { value: 'Renamed' } });
      } else {
        fireEvent.keyDown(research, { key: 'F10', shiftKey: true });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Move selected item' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Destination notebook' }), {
          target: { value: 'Archive' },
        });
      }
      const title = action === 'rename' ? 'Rename item' : 'Move item';
      fireEvent.click(screen.getByRole('button', { name: title }));
      if (watcherRefresh) {
        vi.mocked(bridge.vault.get).mockResolvedValue(updated);
        const changed = vi.mocked(bridge.vault.onChanged).mock.calls[0][0];
        await act(async () => changed({ vaultPath: vault.path, paths: ['Research', destination] }));
        await waitFor(() => expect(bridge.vault.get).toHaveBeenCalledTimes(2));
        await act(async () => finishRelocation(updated));
      }
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument());
      expect(bridge.vault[action]).toHaveBeenCalledWith('Research', action === 'rename' ? 'Renamed' : destination);
      navigate('3');
      if (cancelled) expectResearchContext();
      else {
        expect(screen.getByText(`Items in ${destination}`)).toBeInTheDocument();
        expect(screen.getByRole('gridcell', { name: 'Idea.md' })).toBeInTheDocument();
        expect(screen.queryByRole('gridcell', { name: 'Archived.md' })).not.toBeInTheDocument();
        expect(screen.queryByRole('gridcell', { name: 'Root.md' })).not.toBeInTheDocument();
      }
    },
  );

  it.each([false, true])(
    'cleans up context on deletion without losing it on cancellation (cancelled: %s)',
    async (cancelled) => {
      const { vault, bridge } = renderLibrary();
      await screen.findByRole('heading', { name: 'Study', level: 2 });
      navigate('2');
      const research = screen.getByRole('gridcell', { name: 'Research' });
      research.focus();
      vi.mocked(bridge.vault.delete).mockResolvedValue(
        cancelled ? vault : { ...vault, entries: vault.entries.filter((entry) => entry.path !== 'Research') },
      );
      fireEvent.keyDown(research, { key: 'ContextMenu' });
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete selected item' }));
      await waitFor(() => expect(bridge.vault.delete).toHaveBeenCalledWith('Research'));
      await waitFor(() => expect(screen.queryByRole('gridcell', { name: 'Research' }) !== null).toBe(cancelled));
      navigate('3');
      if (cancelled) expectResearchContext();
      else {
        // Deleting the selected notebook moves the context to the
        // remaining notebook: the view is siloed to Archive now.
        expect(screen.queryByText('Items in Research')).not.toBeInTheDocument();
        expect(screen.getByText('Items in Archive')).toBeInTheDocument();
        const grid = screen.getByRole('grid', { name: 'Notes and files' });
        expect(within(grid).getByRole('gridcell', { name: 'Archived.md' })).toBeInTheDocument();
        expect(within(grid).queryByRole('gridcell', { name: 'Idea.md' })).not.toBeInTheDocument();
      }
    },
  );

  it('clears notebook context when opening another library even if it has the same notebook path', async () => {
    const { vault, bridge } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    navigate('2');
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    expectResearchContext();
    vi.mocked(bridge.vault.open).mockResolvedValue({ ...vault, name: 'Other', path: 'C:/Other' });
    navigate('o');
    await screen.findByRole('heading', { name: 'Other', level: 2 });
    navigate('3');
    expect(screen.queryByText('Items in Research')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('grid', { name: 'Notes and files' })).queryByRole('gridcell', { name: 'Archived.md' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Select a notebook to see its notes and files/)).toBeInTheDocument();
  });

  it('clears notebook context when the library is locked', async () => {
    const { bridge } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    navigate('2');
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    expectResearchContext();
    const locked = vi.mocked(bridge.vault.onSecurityLocked!).mock.calls[0][0];
    act(() => locked());
    await waitFor(() => expect(screen.queryByText('Items in Research')).not.toBeInTheDocument());
    expect(screen.queryByRole('grid', { name: 'Notes and files' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Library password'), { target: { value: 'test-unlock-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock library' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Library locked' })).not.toBeInTheDocument());
    navigate('3');
    expect(screen.queryByText('Items in Research')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('grid', { name: 'Notes and files' })).queryByRole('gridcell', { name: 'Archived.md' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Select a notebook to see its notes and files/)).toBeInTheDocument();
  });

  it.each([
    { change: 'removed', source: 'refresh' },
    { change: 'replaced by a file', source: 'refresh' },
    { change: 'removed', source: 'watcher' },
  ] as const)('clears notebook context when notebook is $change ($source)', async ({ change, source }) => {
    const { vault, bridge, menu } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    navigate('2');
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    expectResearchContext();

    vi.mocked(bridge.vault.get).mockResolvedValue({
      ...vault,
      entries: [
        ...vault.entries.filter((entry) => entry.path !== 'Research'),
        ...(change === 'replaced by a file'
          ? [{ name: 'Research', path: 'Research', kind: 'attachment' as const }]
          : []),
      ],
    });
    if (source === 'refresh') menu('refresh-links');
    else {
      const changed = vi.mocked(bridge.vault.onChanged).mock.calls[0][0];
      await act(async () => changed({ vaultPath: vault.path, paths: ['Research'] }));
    }
    await waitFor(() => expect(screen.queryByText('Items in Research')).not.toBeInTheDocument());
    expect(
      within(screen.getByRole('grid', { name: 'Notes and files' })).queryByRole('gridcell', { name: 'Archived.md' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Select a notebook to see its notes and files/)).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Idea.md' })).not.toBeInTheDocument();
  });

  it('opens the Insert Link dialog with Ctrl+K in the editor', async () => {
    const { menu } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    menu('show-notebooks');
    const notebooks = screen.getByRole('grid', { name: 'Notebooks' });
    fireEvent.keyDown(within(notebooks).getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
    const notesFiles = await screen.findByRole('grid', { name: 'Notes and files' });
    const item = within(notesFiles).getByRole('gridcell', { name: 'Idea.md' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Idea', level: 2 })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    fireEvent.keyDown(editor, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
  });

  it('titles the window with the current view and names the tasks grid for its library', async () => {
    const { menu } = renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    menu('show-notebooks');
    expect(document.title).toBe('Notebooks | Study | A11y Notebook');
    menu('show-tasks');
    expect(await screen.findByRole('table', { name: 'Tasks in Study' })).toBeInTheDocument();
    expect(document.title).toBe('Tasks | Study | A11y Notebook');
    menu('show-assets');
    expect(document.title).toBe('Cognitive Tools | Study | A11y Notebook');
    menu('show-notes-files');
    expect(document.title).toBe('Files | Study | A11y Notebook');
  });
});
