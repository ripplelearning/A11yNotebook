import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import DetailsView from '../renderer/components/DetailsView';
import NotebooksScreen from '../renderer/features/screens/NotebooksScreen';
import NotesFilesScreen from '../renderer/features/screens/NotesFilesScreen';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultEntry } from '../shared/types';
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

  it('routes View commands through real library screens and opens notes from the details grid', async () => {
    const vault = {
      name: 'Study',
      path: 'C:/Study',
      entries: [
        {
          name: 'Research',
          path: 'Research',
          kind: 'notebook' as const,
          children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note' as const }],
        },
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
      },
      onMenuCommand: vi.fn(() => () => undefined),
    } as unknown as NotebookBridge;
    window.a11yNotebook = bridge;
    render(<App />);

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
    const idea = within(notesFiles).getByRole('gridcell', { name: 'Idea.md' });
    fireEvent.keyDown(idea, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Idea', level: 2 })).toBeInTheDocument();
    expect(bridge.vault.readNote).toHaveBeenCalledWith('Research/Idea.md', undefined);
  });
});
