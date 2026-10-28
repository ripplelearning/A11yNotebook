import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibrariesScreen from '../renderer/features/screens/LibrariesScreen';
import type { VaultInfo } from '../shared/types';

const recent = [
  { path: '/home/user/Research Library', name: 'Research Library', lastOpenedAt: '2026-10-20T15:00:00.000Z' },
  { path: '/home/user/Personal', name: 'Personal', lastOpenedAt: '2026-10-18T15:00:00.000Z' },
];

describe('Libraries screen grid', () => {
  it('lists every library in an accessible grid with name and path', () => {
    render(
      <LibrariesScreen vault={null} recentLibraries={recent} onOpenLibrary={vi.fn()} onOpenRecent={vi.fn()} />,
    );
    const grid = screen.getByRole('grid', { name: 'Libraries' });
    expect(within(grid).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'Path' })).toBeInTheDocument();
    expect(screen.getByText('Research Library')).toBeInTheDocument();
    expect(screen.getByText('/home/user/Personal')).toBeInTheDocument();
    // Header row plus one row per library.
    expect(within(grid).getAllByRole('row')).toHaveLength(3);
  });

  it('opens a library with Enter and keeps the current library selected', () => {
    const onOpenRecent = vi.fn();
    const vault = { name: 'Research Library', path: '/home/user/Research Library', entries: [] } as VaultInfo;
    render(
      <LibrariesScreen vault={vault} recentLibraries={recent} onOpenLibrary={vi.fn()} onOpenRecent={onOpenRecent} />,
    );
    // The open library appears once even though it is also recent.
    const grid = screen.getByRole('grid', { name: 'Libraries' });
    expect(within(grid).getAllByRole('row')).toHaveLength(3);
    const currentRow = within(grid).getByText('Research Library').closest('[role="row"]');
    expect(currentRow).toHaveAttribute('aria-selected', 'true');
    const personalRow = within(grid).getByText('Personal').closest('[role="row"]');
    expect(personalRow).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(within(grid).getByText('Personal'), { key: 'Enter' });
    expect(onOpenRecent).toHaveBeenCalledWith('/home/user/Personal');
    fireEvent.keyDown(within(grid).getByText('Research Library'), { key: 'Enter' });
    expect(onOpenRecent).toHaveBeenCalledTimes(1);
  });

  it('shows an empty message when no libraries are known', () => {
    render(<LibrariesScreen vault={null} recentLibraries={[]} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('No libraries yet. Open or create a library to get started.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent libraries' })).toBeNull();
  });
});
