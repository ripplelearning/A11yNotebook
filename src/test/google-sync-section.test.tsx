import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GoogleSyncSection from '../renderer/features/calendar/GoogleSyncSection';
import { resolveGoogleConflict, runGoogleSync } from '../shared/google-sync-run';
import type { VaultBridge } from '../shared/bridge';

vi.mock('../shared/google-sync-run', () => ({
  runGoogleSync: vi.fn(),
  resolveGoogleConflict: vi.fn(),
}));

const mockRun = vi.mocked(runGoogleSync);
const mockResolve = vi.mocked(resolveGoogleConflict);

function setup(status: { configured: boolean; signedIn: boolean }, extra: Record<string, unknown> = {}) {
  let current = status;
  const bridge = {
    googleStatus: vi.fn(async () => current),
    configureGoogle: vi.fn(async () => ({ configured: true })),
    signInGoogle: vi.fn(async () => ({ signedIn: true })),
    signOutGoogle: vi.fn(async () => ({ signedIn: false })),
    getCalendar: vi.fn(async () => []),
    saveCalendar: vi.fn(async (items: unknown) => items),
    getSyncState: vi.fn(async () => ({ version: 1, providers: {}, tombstones: [] })),
    saveSyncState: vi.fn(async (state: unknown) => state),
    getGoogleAccessToken: vi.fn(async () => 'token-1'),
    getSettings: vi.fn(async () => ({ calendarOffline: false })),
    saveSettings: vi.fn(async () => undefined),
    ...extra,
  };
  const onSynced = vi.fn();
  render(<GoogleSyncSection bridge={bridge as unknown as VaultBridge} onSynced={onSynced} />);
  return {
    bridge,
    onSynced,
    setStatus: (next: { configured: boolean; signedIn: boolean }) => {
      current = next;
    },
  };
}

describe('google sync section', () => {
  it('renders nothing when the bridge offers no auth methods', () => {
    render(
      <GoogleSyncSection
        bridge={{} as unknown as VaultBridge}
        onSynced={vi.fn()}
      />,
    );
    expect(screen.queryByText('Google Calendar sync')).toBeNull();
  });

  it('saves a client and refreshes status', async () => {
    const { bridge, setStatus } = setup({ configured: false, signedIn: false });
    expect(await screen.findByText('Google sync is not set up yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: '  cid  ' } });
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'csecret' } });
    setStatus({ configured: true, signedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Save Google client' }));
    await waitFor(() =>
      expect(bridge.configureGoogle).toHaveBeenCalledWith({
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    );
    expect(await screen.findByText('Google client saved. Not signed in.')).toBeTruthy();
  });

  it('requires both client fields', async () => {
    const { bridge } = setup({ configured: false, signedIn: false });
    await screen.findByText('Google sync is not set up yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Google client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter both');
    expect(bridge.configureGoogle).not.toHaveBeenCalled();
  });

  it('signs in and refreshes status', async () => {
    const { bridge, setStatus } = setup({ configured: true, signedIn: false });
    expect(await screen.findByText('Google client saved. Not signed in.')).toBeTruthy();
    setStatus({ configured: true, signedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(bridge.signInGoogle).toHaveBeenCalled());
    expect(await screen.findByText('Signed in with Google.')).toBeTruthy();
  });

  it('runs a sync, reports counts, and refreshes the calendar', async () => {
    mockRun.mockResolvedValueOnce({
      pulled: 2,
      pushed: 1,
      deleted: 0,
      conflicts: [],
    });
    const { onSynced } = setup({ configured: true, signedIn: true });
    expect(await screen.findByText('Signed in with Google.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(
      await screen.findByText('Sync complete: 2 pulled, 1 pushed, 0 deleted, 0 conflicts.'),
    ).toBeTruthy();
    expect(onSynced).toHaveBeenCalled();
  });

  it('lists conflicts and resolves them through the dialog', async () => {
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
    await screen.findByText('Signed in with Google.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Dentist')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
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
    await screen.findByText('Signed in with Google.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });

  it('shows the offline view when the setting is on', async () => {
    setup(
      { configured: true, signedIn: false },
      { getSettings: vi.fn(async () => ({ calendarOffline: true })) },
    );
    expect(await screen.findByText(/never sent to a calendar service/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn sync setup back on' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
  });

  it('going offline signs out and saves the setting', async () => {
    const { bridge } = setup({ configured: true, signedIn: true });
    await screen.findByText('Signed in with Google.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep calendar offline' }));
    await waitFor(() => expect(bridge.signOutGoogle).toHaveBeenCalled());
    await waitFor(() =>
      expect(bridge.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ calendarOffline: true }),
      ),
    );
    expect(await screen.findByText(/never sent to a calendar service/)).toBeTruthy();
  });

  it('turning setup back on clears the setting and restores setup', async () => {
    const { bridge } = setup(
      { configured: true, signedIn: false },
      { getSettings: vi.fn(async () => ({ calendarOffline: true })) },
    );
    await screen.findByText(/never sent to a calendar service/);
    fireEvent.click(screen.getByRole('button', { name: 'Turn sync setup back on' }));
    await waitFor(() =>
      expect(bridge.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ calendarOffline: false }),
      ),
    );
    expect(await screen.findByText('Google client saved. Not signed in.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeTruthy();
  });

  it('signs out and clears the result', async () => {
    mockRun.mockResolvedValueOnce({ pulled: 1, pushed: 0, deleted: 0, conflicts: [] });
    const { bridge, setStatus } = setup({ configured: true, signedIn: true });
    await screen.findByText('Signed in with Google.');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await screen.findByText(/Sync complete/);
    setStatus({ configured: true, signedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(bridge.signOutGoogle).toHaveBeenCalled());
    expect(await screen.findByText('Google client saved. Not signed in.')).toBeTruthy();
  });
});
