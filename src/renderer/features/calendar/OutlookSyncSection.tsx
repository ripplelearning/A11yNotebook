import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveOutlookConflict,
  runOutlookSync,
  type OutlookConflictChoice,
} from '../../../shared/outlook-sync-run';
import type { SyncConflict } from '../../../shared/calendar-sync';
import type { SyncRunResult } from '../../../shared/calendar-sync-engine';
import type { VaultBridge } from '../../../shared/bridge';
import ConflictResolutionDialog from './ConflictResolutionDialog';

/**
 * Outlook Calendar sync controls for the Calendar screen: client setup,
 * sign-in and sign-out, running a sync through the engine, and resolving
 * sync conflicts. Rendered only when the bridge offers the auth methods.
 * Outlook uses a public native client with PKCE, so setup asks only for
 * an Application (client) ID: there is no client secret.
 *
 * A sync that ends with conflicts keeps the local version and freezes
 * the sync state, so the same conflicts are reported again on the next
 * sync until the user resolves them: keeping local pushes the local
 * version to Outlook, taking Outlook saves the Outlook version locally.
 *
 * This section has no offline control of its own: when the library
 * setting "Keep calendar offline" is on, it renders nothing, and the
 * single offline view in the Google Calendar sync section above is the
 * one control for every provider. Turning sync back on there brings
 * this section back.
 */
export default function OutlookSyncSection({
  bridge,
  onSynced,
}: {
  bridge: VaultBridge;
  onSynced: () => void;
}) {
  const supported = typeof bridge.outlookStatus === 'function';
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; signedIn: boolean } | null>(null);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncRunResult | null>(null);
  const [resolving, setResolving] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!bridge.outlookStatus) return;
    try {
      setStatus(await bridge.outlookStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read Outlook sync status.');
    }
  }, [bridge]);

  useEffect(() => {
    void refreshStatus();
    if (typeof bridge.getSettings === 'function') {
      bridge
        .getSettings()
        .then((settings) => setOffline(settings.calendarOffline === true))
        .catch(() => undefined);
    }
  }, [bridge, refreshStatus]);

  if (!supported || offline) return null;

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    if (operation.current) return;
    operation.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Outlook sync failed.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  async function saveClient(): Promise<void> {
    await runAction('Saving Outlook client…', async () => {
      if (!bridge.configureOutlook) throw new Error('Outlook sync is unavailable in this version.');
      if (!clientId.trim()) {
        throw new Error('Enter a client ID.');
      }
      await bridge.configureOutlook({ clientId: clientId.trim() });
      await refreshStatus();
      setMessage('Outlook client saved. Now sign in with Outlook.');
    });
  }

  async function signIn(): Promise<void> {
    await runAction('Waiting for browser sign-in…', async () => {
      if (!bridge.signInOutlook) throw new Error('Outlook sync is unavailable in this version.');
      await bridge.signInOutlook();
      await refreshStatus();
      // No separate message: the status line already says signed in.
    });
  }

  async function signOut(): Promise<void> {
    await runAction('Signing out…', async () => {
      if (!bridge.signOutOutlook) throw new Error('Outlook sync is unavailable in this version.');
      await bridge.signOutOutlook();
      setResult(null);
      await refreshStatus();
      setMessage('Signed out of Outlook.');
    });
  }

  async function syncNow(): Promise<void> {
    await runAction('Syncing with Outlook…', async () => {
      if (
        !bridge.getCalendar ||
        !bridge.saveCalendar ||
        !bridge.getSyncState ||
        !bridge.saveSyncState ||
        !bridge.getOutlookAccessToken
      ) {
        throw new Error('Outlook sync is unavailable in this version.');
      }
      const run = await runOutlookSync({
        getCalendar: bridge.getCalendar,
        saveCalendar: bridge.saveCalendar,
        getSyncState: bridge.getSyncState,
        saveSyncState: bridge.saveSyncState,
        getAccessToken: bridge.getOutlookAccessToken,
      });
      setResult(run);
      onSynced();
      setMessage(
        `Sync complete: ${run.pulled} pulled, ${run.pushed} pushed, ${run.deleted} deleted, ${run.conflicts.length} conflicts.`,
      );
    });
  }

  async function resolveConflict(conflict: SyncConflict, choice: OutlookConflictChoice): Promise<void> {
    await runAction('Resolving conflict…', async () => {
      const getCalendar = bridge.getCalendar;
      const saveCalendar = bridge.saveCalendar;
      const getSyncState = bridge.getSyncState;
      const saveSyncState = bridge.saveSyncState;
      const getAccessToken = bridge.getOutlookAccessToken;
      if (!getCalendar || !saveCalendar || !getSyncState || !saveSyncState || !getAccessToken) {
        throw new Error('Outlook sync is unavailable in this version.');
      }
      await resolveOutlookConflict(
        { getCalendar, saveCalendar, getSyncState, saveSyncState, getAccessToken },
        conflict,
        choice,
      );
      const next = (result?.conflicts ?? []).filter((item) => item.local.id !== conflict.local.id);
      setResult(result ? { ...result, conflicts: next } : null);
      onSynced();
      if (next.length === 0) {
        setResolving(false);
        setMessage('All conflicts resolved. Run Sync now again to finish the sync.');
      } else {
        setMessage('Conflict resolved.');
      }
    });
  }

  const statusText = !status
    ? 'Outlook sync status is unavailable.'
    : status.signedIn
      ? 'Signed in with Outlook.'
      : status.configured
        ? 'Outlook client saved. Not signed in.'
        : 'Outlook sync is not set up yet.';

  return (
    <section aria-labelledby="outlook-sync-heading">
      <h2 id="outlook-sync-heading">Outlook Calendar sync</h2>
      {error && <p role="alert">{error}</p>}
      {(busy ?? message) && <p role="status">{busy ?? message}</p>}
      <p>{statusText}</p>
      <p>
        To keep your calendar offline instead of syncing, use the Keep calendar offline control in
        the Google Calendar sync section above: it turns off sync for every provider.
      </p>
      {!status?.configured && (
        <div>
          <p>
            Create an app registration in the Entra portal (see the user guide), then enter its
            Application (client) ID here. Outlook uses a public native client, so there is no
            client secret.
          </p>
          <div>
            <label htmlFor="outlook-client-id">Client ID</label>
            <input
              id="outlook-client-id"
              type="text"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <button type="button" onClick={() => void saveClient()} disabled={busy !== null}>
            Save Outlook client
          </button>
        </div>
      )}
      {status?.configured && !status.signedIn && (
        <button type="button" onClick={() => void signIn()} disabled={busy !== null}>
          Sign in with Outlook
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
            These appointments changed both locally and in Outlook, so the local version was kept.
            Resolve each one to choose which version wins.
          </p>
          <ul>
            {result.conflicts.map((conflict) => (
              <li key={conflict.local.id}>{conflict.local.title}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setResolving(true)} disabled={busy !== null}>
            Resolve conflicts
          </button>
        </div>
      )}
      {resolving && result && result.conflicts.length > 0 && (
        <ConflictResolutionDialog
          conflicts={result.conflicts}
          onResolve={(conflict, choice) => resolveConflict(conflict, choice)}
          onClose={() => setResolving(false)}
          providerLabel="Outlook"
        />
      )}
    </section>
  );
}
