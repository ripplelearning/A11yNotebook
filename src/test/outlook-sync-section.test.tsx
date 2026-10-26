import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OutlookSyncSection from '../renderer/features/calendar/OutlookSyncSection';
import { resolveOutlookConflict, runOutlookSync } from '../shared/outlook-sync-run';
import type { VaultBridge } from '../shared/bridge';

vi.mock('../shared/outlook-sync-run', () => ({
  runOutlookSync: vi.fn(),
  resolveOutlookConflict: vi.fn(),
}));

const mockRun = vi.mocked(runOutlookSync);
const mockResolve = vi.mocked(resolveOutlookConflict);

function setup(status: { configured: boolean; signedIn: boolean }, extra: Record<string, unknown> = {}) {
  let current = status;
  const bridge = {
    outlookStatus: vi.fn(async () => current),
    configureOutlook: vi.fn(async () => ({ configured: true })),
    signInOutlook: vi.fn(async () => ({ signedIn: true })),
    signOutOutlook: vi.fn(async () => ({ signedIn: false })),
    getCalendar: vi.fn(async () => []),
    saveCalendar: vi.fn(async (items: unknown) => items),
    getSyncState: vi.fn(async () => ({ version: 1, providers: {}, tombstones: [] })),
    saveSyncState: vi.fn(async (state: unknown) => state),
    getOutlookAccessToken: vi.fn(async () => 'token-1'),
    getSettings: vi.fn(async () => ({ calendarOffline: false })),
    ...extra,
  };
  const onSynced = vi.fn();
  render(<OutlookSyncSection bridge={bridge as unknown as VaultBridge} onSynced={onSynced} />);
  return {
    bridge,
    onSynced,
    setStatus: (next: { configured: boolean; signedIn: boolean }) => {
      current = next;
    },
  };
}

describe('outlook sync section', () => {
  it('renders nothing when the bridge offers no auth methods', () => {
    render(<OutlookSyncSection bridge={{} as unknown as VaultBridge} onSynced={vi.fn()} />);
    expect(screen.queryByText('Outlook Calendar sync')).toBeNull();
  });

  it('saves a client id and refreshes status', async () => {
    const { bridge, setStatus } = setup({ configured: false, signedIn: false });
    expect(await screen.findByText('Outlook sync is not set up yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: '  cid  ' } });
    setStatus({ configured: true, signedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Save Outlook client' }));
    await waitFor(() => expect(bridge.configureOutlook).toHaveBeenCalledWith({ clientId: 'cid' }));
    expect(await screen.findByText('Outlook client saved. Not signed in.')).toBeTruthy();
  });

  it('requires a client id', async () => {
    const { bridge } = setup({ configured: false, signedIn: false });
    await screen.findByText('Outlook sync is not set up yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Outlook client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a client ID');
    expect(bridge.configureOutlook).not.toHaveBeenCalled();
  });

  it('signs in and refreshes status', async () => {
    const { bridge, setStatus } = setup({ configured: true, signedIn: false });
    expect(await screen.findByText('Outlook client saved. Not signed in.')).toBeTruthy();
    setStatus({ configured: true, signedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Outlook' }));
    await waitFor(() => expect(bridge.signInOutlook).toHaveBeenCalled());
    expect(await screen.findByText('Signed in with Outlook.')).toBeTruthy();
  });

  it('runs a sync, reports counts, and refreshes the calendar', async () => {
    mockRun.mockResolvedValueOnce({
      pulled: 2,
      pushed: 1,
      deleted: 0,
      conflicts: [],
    });
    const { onSynced } = setup({ configured: true, signedIn: true });
    expect(await screen.findByText('Signed in with Outlook.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(
      await screen.findByText('Sync complete: 2 pulled, 1 pushed, 0 deleted, 0 conflicts.'),
    ).toBeTruthy();
    expect(onSynced).toHaveBeenCalled();
  });

  it('lists conflicts and resolves them through the Outlook-labelled dialog', async () => {
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
    await screen.findByText('Signed in with Outlook.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Dentist')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take Outlook version' })).toBeTruthy();
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
    await screen.findByText('Signed in with Outlook.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });

  it('renders nothing when the offline setting is on', async () => {
    setup(
      { configured: true, signedIn: false },
      { getSettings: vi.fn(async () => ({ calendarOffline: true })) },
    );
    // The Google section owns the offline view; this section disappears.
    await waitFor(() => expect(screen.queryByText('Outlook Calendar sync')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Sign in with Outlook' })).toBeNull();
  });

  it('signs out and clears the result', async () => {
    mockRun.mockResolvedValueOnce({ pulled: 1, pushed: 0, deleted: 0, conflicts: [] });
    const { bridge, setStatus } = setup({ configured: true, signedIn: true });
    await screen.findByText('Signed in with Outlook.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await screen.findByText(/Sync complete/);
    setStatus({ configured: true, signedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(bridge.signOutOutlook).toHaveBeenCalled());
    expect(await screen.findByText('Outlook client saved. Not signed in.')).toBeTruthy();
  });
});
