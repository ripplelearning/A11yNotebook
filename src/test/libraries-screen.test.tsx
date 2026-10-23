import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibrariesScreen from '../renderer/features/screens/LibrariesScreen';
import type { VaultInfo } from '../shared/types';

const recent = [
  { path: '/home/user/Research Library', name: 'Research Library', lastOpenedAt: '2026-10-20T15:00:00.000Z' },
  { path: '/home/user/Personal', name: 'Personal', lastOpenedAt: '2026-10-18T15:00:00.000Z' },
];

describe('Libraries screen recent-library picker', () => {
  it('lists recent libraries and opens one directly', () => {
    const onOpenRecent = vi.fn();
    render(
      <LibrariesScreen vault={null} recentLibraries={recent} onOpenLibrary={vi.fn()} onOpenRecent={onOpenRecent} />,
    );
    expect(screen.getByRole('heading', { name: 'Recent libraries' })).toBeTruthy();
    expect(screen.getByText('/home/user/Personal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Personal' }));
    expect(onOpenRecent).toHaveBeenCalledWith('/home/user/Personal');
  });

  it('marks the current library and disables its open button', () => {
    const vault = { name: 'Research Library', path: '/home/user/Research Library', entries: [] } as VaultInfo;
    render(<LibrariesScreen vault={vault} recentLibraries={recent} onOpenLibrary={vi.fn()} onOpenRecent={vi.fn()} />);
    const current = screen.getByRole('button', { name: /Open Research Library \(current\)/ });
    expect(current).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Open Personal' })).toHaveProperty('disabled', false);
  });

  it('shows no recent section when there are no recent libraries', () => {
    render(<LibrariesScreen vault={null} recentLibraries={[]} onOpenLibrary={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Recent libraries' })).toBeNull();
  });
});
