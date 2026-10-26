import { useCallback, useEffect, useRef, useState } from 'react';
import { runGoogleSync } from '../../../shared/google-sync-run';
import type { SyncRunResult } from '../../../shared/calendar-sync-engine';
import type { VaultBridge } from '../../../shared/bridge';

/**
 * Google Calendar sync controls for the Calendar screen: client setup,
 * sign-in and sign-out, and running a sync through the engine. Rendered
 * only when the bridge offers the auth methods. Conflict resolution is
 * not built yet: a sync reports conflicts and keeps the local version,
 * and the same conflicts are reported again on the next sync until
 * resolution lands.
 */
export default function GoogleSyncSection({
  bridge,
  onSynced,
}: {
  bridge: VaultBridge;
  onSynced: () => void;
}) {
  const supported = typeof bridge.googleStatus === 'function';
  const [status, setStatus] = useState<{ configured: boolean; signedIn: boolean } | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncRunResult | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!bridge.googleStatus) return;
    try {
      setStatus(await bridge.googleStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read Google sync status.');
    }
  }, [bridge]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (!supported) return null;

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    if (operation.current) return;
    operation.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google sync failed.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  async function saveClient(): Promise<void> {
    await runAction('Saving Google client…', async () => {
      if (!bridge.configureGoogle) throw new Error('Google sync is unavailable in this version.');
      if (!clientId.trim() || !clientSecret.trim()) {
        throw new Error('Enter both a client ID and a client secret.');
      }
      await bridge.configureGoogle({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setClientSecret('');
      await refreshStatus();
      setMessage('Google client saved. Now sign in with Google.');
    });
  }

  async function signIn(): Promise<void> {
    await runAction('Waiting for browser sign-in…', async () => {
      if (!bridge.signInGoogle) throw new Error('Google sync is unavailable in this version.');
      await bridge.signInGoogle();
      await refreshStatus();
      // No separate message: the status line already says signed in.
    });
  }

  async function signOut(): Promise<void> {
    await runAction('Signing out…', async () => {
      if (!bridge.signOutGoogle) throw new Error('Google sync is unavailable in this version.');
      await bridge.signOutGoogle();
      setResult(null);
      await refreshStatus();
      setMessage('Signed out of Google.');
    });
  }

  async function syncNow(): Promise<void> {
    await runAction('Syncing with Google…', async () => {
      if (
        !bridge.getCalendar ||
        !bridge.saveCalendar ||
        !bridge.getSyncState ||
        !bridge.saveSyncState ||
        !bridge.getGoogleAccessToken
      ) {
        throw new Error('Google sync is unavailable in this version.');
      }
      const run = await runGoogleSync({
        getCalendar: bridge.getCalendar,
        saveCalendar: bridge.saveCalendar,
        getSyncState: bridge.getSyncState,
        saveSyncState: bridge.saveSyncState,
        getAccessToken: bridge.getGoogleAccessToken,
      });
      setResult(run);
      onSynced();
      setMessage(
        `Sync complete: ${run.pulled} pulled, ${run.pushed} pushed, ${run.deleted} deleted, ${run.conflicts.length} conflicts.`,
      );
    });
  }

  const statusText = !status
    ? 'Google sync status is unavailable.'
    : status.signedIn
      ? 'Signed in with Google.'
      : status.configured
        ? 'Google client saved. Not signed in.'
        : 'Google sync is not set up yet.';

  return (
    <section aria-labelledby="google-sync-heading">
      <h2 id="google-sync-heading">Google Calendar sync</h2>
      {error && <p role="alert">{error}</p>}
      {(busy ?? message) && <p role="status">{busy ?? message}</p>}
      <p>{statusText}</p>
      {!status?.configured && (
        <div>
          <p>
            Create a Desktop-app OAuth client in Google Cloud Console (see the user guide), then
            enter it here. The secret is stored encrypted on this device.
          </p>
          <div>
            <label htmlFor="google-client-id">Client ID</label>
            <input
              id="google-client-id"
              type="text"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <div>
            <label htmlFor="google-client-secret">Client secret</label>
            <input
              id="google-client-secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <button type="button" onClick={() => void saveClient()} disabled={busy !== null}>
            Save Google client
          </button>
        </div>
      )}
      {status?.configured && !status.signedIn && (
        <button type="button" onClick={() => void signIn()} disabled={busy !== null}>
          Sign in with Google
        </button>
      )}
      {status?.signedIn && (
        <div>
          <button type="button" onClick={() => void syncNow()} disabled={busy !== null}>
            Sync now
          </button>
          <button type="button" onClick={() => void signOut()} disabled={busy !== null}>
            Sign out
          </button>
        </div>
      )}
      {result && result.conflicts.length > 0 && (
        <div>
          <p>
            These appointments changed both locally and in Google, so the local version was kept.
            Conflict resolution is not built yet; the same conflicts will be reported again on the
            next sync until then.
          </p>
          <ul>
            {result.conflicts.map((conflict) => (
              <li key={conflict.local.id}>{conflict.local.title}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
