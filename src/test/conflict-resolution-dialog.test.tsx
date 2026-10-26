import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConflictResolutionDialog from '../renderer/features/calendar/ConflictResolutionDialog';
import type { SyncConflict } from '../shared/calendar-sync';

const conflict: SyncConflict = {
  local: {
    id: 'local-1',
    title: 'Dentist',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    provider: 'google',
    externalId: 'g-1',
  },
  remote: {
    id: 'remote-1',
    title: 'Dentist!',
    start: '2026-11-02T11:00:00-08:00',
    allDay: false,
    provider: 'google',
    externalId: 'g-1',
  },
};

describe('conflict resolution dialog', () => {
  it('shows both versions and resolves with the chosen side', async () => {
    const onResolve = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<ConflictResolutionDialog conflicts={[conflict]} onResolve={onResolve} onClose={onClose} />);
    expect(screen.getByText('Local version')).toBeTruthy();
    expect(screen.getByText('Google version')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep local version' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(conflict, 'local'));
    fireEvent.click(screen.getByRole('button', { name: 'Take Google version' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(conflict, 'remote'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables choices while a resolution runs and shows failures', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onResolve = vi.fn(() => pending);
    render(
      <ConflictResolutionDialog conflicts={[conflict]} onResolve={onResolve} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep local version' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Keep local version' })).toHaveProperty(
        'disabled',
        true,
      ),
    );
    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Keep local version' })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    onResolve.mockRejectedValueOnce(new Error('Network down'));
    fireEvent.click(screen.getByRole('button', { name: 'Take Google version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });
});
