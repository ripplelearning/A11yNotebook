import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppleSyncSection from '../renderer/features/calendar/AppleSyncSection';
import { resolveAppleConflict, runAppleSync } from '../shared/apple-sync-run';
import type { VaultBridge } from '../shared/bridge';

vi.mock('../shared/apple-sync-run', () => ({
  runAppleSync: vi.fn(),
  resolveAppleConflict: vi.fn(),
}));

const mockRun = vi.mocked(runAppleSync);
const mockResolve = vi.mocked(resolveAppleConflict);

function setup(status: { configured: boolean; signedIn: boolean }, extra: Record<string, unknown> = {}) {
  let current = status;
  const bridge = {
    appleStatus: vi.fn(async () => current),
    configureApple: vi.fn(async () => ({ configured: true })),
    verifyApple: vi.fn(async () => ({ calendarName: 'Calendar' })),
    signOutApple: vi.fn(async () => ({ signedIn: false })),
    getCalendar: vi.fn(async () => []),
    saveCalendar: vi.fn(async (items: unknown) => items),
    getSyncState: vi.fn(async () => ({ version: 1, providers: {}, tombstones: [] })),
    saveSyncState: vi.fn(async (state: unknown) => state),
    getAppleCredentials: vi.fn(async () => ({ appleId: 'test@icloud.com', appPassword: 'pw' })),
    getSettings: vi.fn(async () => ({ calendarOffline: false })),
    ...extra,
  };
  const onSynced = vi.fn();
  render(<AppleSyncSection bridge={bridge as unknown as VaultBridge} onSynced={onSynced} />);
  return {
    bridge,
    onSynced,
    setStatus: (next: { configured: boolean; signedIn: boolean }) => {
      current = next;
    },
  };
}

describe('apple sync section', () => {
  it('renders nothing when the bridge offers no auth methods', () => {
    render(<AppleSyncSection bridge={{} as unknown as VaultBridge} onSynced={vi.fn()} />);
    expect(screen.queryByText('Apple Calendar sync')).toBeNull();
  });

  it('saves a sign-in, verifies, and refreshes status', async () => {
    const { bridge, setStatus } = setup({ configured: false, signedIn: false });
    expect(await screen.findByText('Apple sync is not set up yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Apple ID'), { target: { value: '  test@icloud.com  ' } });
    fireEvent.change(screen.getByLabelText('App-specific password'), {
      target: { value: 'abcd-efgh' },
    });
    setStatus({ configured: true, signedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save Apple sign-in' }));
    await waitFor(() =>
      expect(bridge.configureApple).toHaveBeenCalledWith({
        appleId: 'test@icloud.com',
        appPassword: 'abcd-efgh',
      }),
    );
    await waitFor(() => expect(bridge.verifyApple).toHaveBeenCalled());
    expect(await screen.findByText('Connected to calendar "Calendar".')).toBeTruthy();
    expect(await screen.findByText('Signed in with Apple.')).toBeTruthy();
  });

  it('requires both fields', async () => {
    const { bridge } = setup({ configured: false, signedIn: false });
    await screen.findByText('Apple sync is not set up yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Apple sign-in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an Apple ID');
    expect(bridge.configureApple).not.toHaveBeenCalled();
  });

  it('runs a sync, reports counts, and refreshes the calendar', async () => {
    mockRun.mockResolvedValueOnce({
      pulled: 2,
      pushed: 1,
      deleted: 0,
      conflicts: [],
    });
    const { onSynced } = setup({ configured: true, signedIn: true });
    expect(await screen.findByText('Signed in with Apple.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(
      await screen.findByText('Sync complete: 2 pulled, 1 pushed, 0 deleted, 0 conflicts.'),
    ).toBeTruthy();
    expect(onSynced).toHaveBeenCalled();
  });

  it('lists conflicts and resolves them through the Apple-labelled dialog', async () => {
    mockRun.mockResolvedValueOnce({
      pulled: 1,
      pushed: 0,
      deleted: 0,
      conflicts: [
        {
          local: { id: 'local-1', title: 'Dentist', start: '2026-11-02', allDay: false },
          remote: { id: 'remote-1', title: 'Dentist!', start: '2026-11-02', allDay: false },
        },
      ],
    });
    mockResolve.mockResolvedValueOnce(undefined);
    setup({ configured: true, signedIn: true });
    await screen.findByText('Signed in with Apple.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Dentist')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take Apple version' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep local version' }));
    await waitFor(() => expect(mockResolve).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText('All conflicts resolved. Run Sync now again to finish the sync.'),
    ).toBeTruthy();
  });

  it('shows sync failures as an alert', async () => {
    mockRun.mockRejectedValueOnce(new Error('Network down'));
    setup({ configured: true, signedIn: true });
    await screen.findByText('Signed in with Apple.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });

  it('renders nothing when the offline setting is on', async () => {
    setup(
      { configured: true, signedIn: false },
      { getSettings: vi.fn(async () => ({ calendarOffline: true })) },
    );
    await waitFor(() => expect(screen.queryByText('Apple Calendar sync')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Save Apple sign-in' })).toBeNull();
  });

  it('signs out and clears the result', async () => {
    mockRun.mockResolvedValueOnce({ pulled: 1, pushed: 0, deleted: 0, conflicts: [] });
    const { bridge, setStatus } = setup({ configured: true, signedIn: true });
    await screen.findByText('Signed in with Apple.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await screen.findByText(/Sync complete/);
    setStatus({ configured: true, signedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(bridge.signOutApple).toHaveBeenCalled());
    expect(
      await screen.findByText('Apple ID saved. Enter your app-specific password to sign in again.'),
    ).toBeTruthy();
  });
});
