import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import DetailsView from '../renderer/components/DetailsView';
import NotebooksScreen from '../renderer/features/screens/NotebooksScreen';
import NotesFilesScreen from '../renderer/features/screens/NotesFilesScreen';
import VaultTree from '../renderer/features/vault/VaultTree';
import type { NotebookBridge } from '../shared/bridge';
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
  const onContextMenu = vi.fn();
  render(
    <DetailsView
      label="Notebook items"
      items={items}
      selectedPath={null}
      onSelect={onSelect}
      onOpen={onOpen}
      onRename={onRename}
      onContextMenu={onContextMenu}
      {...overrides}
    />,
  );
  return { onSelect, onOpen, onRename, onContextMenu };
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
          { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note' },
          { name: 'Report.txt', path: 'Research/Report.txt', kind: 'attachment' },
        ],
      },
      {
        name: 'Archive',
        path: 'Archive',
        kind: 'notebook',
        children: [{ name: 'Archived.md', path: 'Archive/Archived.md', kind: 'note' }],
      },
      { name: 'Root.md', path: 'Root.md', kind: 'note' },
    ],
  };
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
    onMenuCommand: vi.fn(() => () => undefined),
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  render(<App />);
  return { vault, bridge };
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

  it.each([
    { name: 'Idea.md', path: 'Research/Idea.md', heading: 'Idea' },
    { name: 'Report.txt', path: 'Research/Report.txt', heading: 'Report.txt' },
  ])('preserves notebook context when selecting and opening $name', async ({ name, path, heading }) => {
    const { bridge } = renderLibrary();

    await screen.findByRole('heading', { name: 'Study', level: 2 });
    const viewMenu = screen.getByRole('group', { name: 'View' });
    fireEvent.click(within(viewMenu).getByRole('button', { name: 'Contents' }));
    expect(screen.getByRole('heading', { name: 'Contents' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Libraries (1)' }));
    expect(screen.getByRole('heading', { name: 'Libraries' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Open library' })).toBeInTheDocument();

    fireEvent.click(within(viewMenu).getByRole('button', { name: 'Notebooks' }));
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
    if (name === 'Idea.md') expect(bridge.vault.readNote).toHaveBeenCalledWith(path, undefined);
    else expect(bridge.vault.readAttachment).toHaveBeenCalledWith(path);

    navigate('3');
    expectResearchContext();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh links' }));
    await waitFor(() => expect(bridge.vault.get).toHaveBeenCalledTimes(2));
    expectResearchContext();
    navigate('0');
    expect(screen.getByRole('heading', { name: 'Contents' })).toBeInTheDocument();
    navigate('1');
    expect(screen.getByRole('heading', { name: 'Libraries' })).toBeInTheDocument();
    navigate('2');
    expect(screen.getByRole('heading', { name: 'Notebooks' })).toBeInTheDocument();
    navigate('3');
    expectResearchContext();
    navigate('k');
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByRole('searchbox', { name: 'Search commands' })).toHaveFocus();
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
        fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed' } });
      } else {
        fireEvent.keyDown(research, { key: 'F10', shiftKey: true });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Move' }));
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
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await waitFor(() => expect(bridge.vault.delete).toHaveBeenCalledWith('Research'));
      await waitFor(() => expect(screen.queryByRole('gridcell', { name: 'Research' }) !== null).toBe(cancelled));
      navigate('3');
      if (cancelled) expectResearchContext();
      else {
        expect(screen.queryByText('Items in Research')).not.toBeInTheDocument();
        expect(screen.getByRole('gridcell', { name: 'Archived.md' })).toBeInTheDocument();
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
    expect(screen.getByRole('gridcell', { name: 'Archived.md' })).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'test-unlock-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Vault locked' })).not.toBeInTheDocument());
    navigate('3');
    expect(screen.queryByText('Items in Research')).not.toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Archived.md' })).toBeInTheDocument();
  });

  it.each([
    { change: 'removed', source: 'refresh' },
    { change: 'replaced by a file', source: 'refresh' },
    { change: 'removed', source: 'watcher' },
  ] as const)('clears notebook context when notebook is $change ($source)', async ({ change, source }) => {
    const { vault, bridge } = renderLibrary();
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
    if (source === 'refresh') fireEvent.click(screen.getByRole('button', { name: 'Refresh links' }));
    else {
      const changed = vi.mocked(bridge.vault.onChanged).mock.calls[0][0];
      await act(async () => changed({ vaultPath: vault.path, paths: ['Research'] }));
    }
    await waitFor(() => expect(screen.queryByText('Items in Research')).not.toBeInTheDocument());
    expect(screen.getByRole('gridcell', { name: 'Archived.md' })).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: 'Idea.md' })).not.toBeInTheDocument();
  });
});
