import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveAppleConflict,
  runAppleSync,
  type AppleConflictChoice,
} from '../../../shared/apple-sync-run';
import type { SyncConflict } from '../../../shared/calendar-sync';
import type { SyncRunResult } from '../../../shared/calendar-sync-engine';
import type { VaultBridge } from '../../../shared/bridge';
import ConflictResolutionDialog from './ConflictResolutionDialog';

/**
 * Apple Calendar sync controls for the Calendar screen: app-specific
 * password setup, a connection check, running a sync through the
 * engine, and resolving sync conflicts. Rendered only when the bridge
 * offers the auth methods. Apple has no browser sign-in step: saving
 * the Apple ID and app-specific password signs in, and the save also
 * verifies the sign-in by running CalDAV discovery, so a typo'd
 * password fails fast with Apple's own error.
 *
 * A sync that ends with conflicts keeps the local version and freezes
 * the sync state, so the same conflicts are reported again on the next
 * sync until the user resolves them: keeping local pushes the local
 * version to Apple, taking Apple saves the Apple version locally.
 *
 * The calendar picker lists the account's event calendars. Without a
 * pick, sync uses the first event calendar found, and the first sync
 * records it, so the picker shows the current calendar either way.
 * Switching calendars resets Apple sync state and unlinks existing
 * Apple events from local appointments (the appointments themselves
 * stay): the next sync uploads them to the new calendar. Switching
 * therefore asks for confirmation when the library already synced
 * with Apple or has linked appointments.
 *
 * This section has no offline control of its own: when the library
 * setting "Keep calendar offline" is on, it renders nothing, and the
 * single offline view in the Google Calendar sync section above is the
 * one control for every provider. Turning sync back on there brings
 * this section back.
 */
export default function AppleSyncSection({
  bridge,
  onSynced,
}: {
  bridge: VaultBridge;
  onSynced: () => void;
}) {
  const supported = typeof bridge.appleStatus === 'function';
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; signedIn: boolean } | null>(null);
  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncRunResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [calendars, setCalendars] = useState<Array<{ name: string; url: string }> | null>(null);
  const [pickedUrl, setPickedUrl] = useState('');
  const [savedPick, setSavedPick] = useState<{ url: string; name: string } | null>(null);
  const [confirmingSwitch, setConfirmingSwitch] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!bridge.appleStatus) return;
    try {
      setStatus(await bridge.appleStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read Apple sync status.');
    }
  }, [bridge]);

  const refreshPick = useCallback(async () => {
    if (!bridge.getSyncState) return;
    try {
      const state = await bridge.getSyncState();
      const apple = state.providers.apple;
      if (apple?.calendarUrl) {
        setSavedPick({ url: apple.calendarUrl, name: apple.calendarName ?? apple.calendarUrl });
        setPickedUrl(apple.calendarUrl);
      } else {
        setSavedPick(null);
      }
    } catch {
      // The picker is an enhancement; sync works without it.
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

  useEffect(() => {
    if (status?.signedIn) void refreshPick();
  }, [status?.signedIn, refreshPick]);

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
      setError(caught instanceof Error ? caught.message : 'Apple sync failed.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  async function saveSignIn(): Promise<void> {
    await runAction('Saving Apple sign-in…', async () => {
      if (!bridge.configureApple) throw new Error('Apple sync is unavailable in this version.');
      if (!appleId.trim() || !appPassword.trim()) {
        throw new Error('Enter an Apple ID and an app-specific password.');
      }
      await bridge.configureApple({ appleId: appleId.trim(), appPassword: appPassword.trim() });
      setAppPassword('');
      await refreshStatus();
      if (bridge.verifyApple) {
        const verified = await bridge.verifyApple();
        setMessage(`Connected to calendar "${verified.calendarName}".`);
      } else {
        setMessage('Apple sign-in saved.');
      }
    });
  }

  async function signOut(): Promise<void> {
    await runAction('Signing out…', async () => {
      if (!bridge.signOutApple) throw new Error('Apple sync is unavailable in this version.');
      await bridge.signOutApple();
      setResult(null);
      setCalendars(null);
      setSavedPick(null);
      setPickedUrl('');
      setConfirmingSwitch(false);
      await refreshStatus();
      setMessage('Signed out of Apple. Your Apple ID is kept; enter a password to sign in again.');
    });
  }

  async function loadCalendars(): Promise<void> {
    await runAction('Loading Apple calendars…', async () => {
      if (!bridge.listAppleCalendars) throw new Error('Apple sync is unavailable in this version.');
      const list = await bridge.listAppleCalendars();
      if (!list.length) throw new Error('Apple returned no event calendar for this account.');
      setCalendars(list);
      setPickedUrl((current) =>
        list.some((calendar) => calendar.url === current) ? current : list[0].url,
      );
      setMessage(`Found ${list.length} Apple ${list.length === 1 ? 'calendar' : 'calendars'}.`);
    });
  }

  async function savePick(): Promise<void> {
    await runAction('Saving Apple calendar…', async () => {
      if (
        !bridge.getSyncState ||
        !bridge.saveSyncState ||
        !bridge.getCalendar ||
        !bridge.saveCalendar
      ) {
        throw new Error('Apple sync is unavailable in this version.');
      }
      const chosen = calendars?.find((calendar) => calendar.url === pickedUrl);
      if (!chosen) throw new Error('Choose a calendar first.');
      if (savedPick && chosen.url === savedPick.url) {
        setMessage(`Already syncing with "${chosen.name}".`);
        return;
      }
      const state = await bridge.getSyncState();
      const appointments = await bridge.getCalendar();
      const linked = appointments.some((item) => item.provider === 'apple' && item.externalId);
      const hadSync = Boolean(
        state.providers.apple?.lastSyncAt || state.providers.apple?.syncToken,
      );
      if ((linked || hadSync) && !confirmingSwitch) {
        setConfirmingSwitch(true);
        setMessage(
          'Switching calendars unlinks your existing Apple events: appointments stay local and will upload to the new calendar on the next sync. Confirm to switch, or cancel to keep the current calendar.',
        );
        return;
      }
      await bridge.saveSyncState({
        ...state,
        providers: {
          ...state.providers,
          apple: { provider: 'apple', calendarUrl: chosen.url, calendarName: chosen.name },
        },
      });
      if (linked) {
        const cleared = appointments.map((item) => {
          if (item.provider !== 'apple') return item;
          const next = { ...item };
          delete next.provider;
          delete next.externalId;
          return next;
        });
        await bridge.saveCalendar(cleared);
      }
      setSavedPick({ url: chosen.url, name: chosen.name });
      setConfirmingSwitch(false);
      onSynced();
      setMessage(
        `Now syncing with "${chosen.name}".${linked ? ' Existing Apple links were cleared; appointments will upload to the new calendar on the next sync.' : ''}`,
      );
    });
  }

  async function syncNow(): Promise<void> {
    await runAction('Syncing with Apple…', async () => {
      if (
        !bridge.getCalendar ||
        !bridge.saveCalendar ||
        !bridge.getSyncState ||
        !bridge.saveSyncState ||
        !bridge.getAppleCredentials
      ) {
        throw new Error('Apple sync is unavailable in this version.');
      }
      const run = await runAppleSync({
        getCalendar: bridge.getCalendar,
        saveCalendar: bridge.saveCalendar,
        getSyncState: bridge.getSyncState,
        saveSyncState: bridge.saveSyncState,
        getCredentials: bridge.getAppleCredentials,
      });
      setResult(run);
      await refreshPick();
      onSynced();
      setMessage(
        `Sync complete: ${run.pulled} pulled, ${run.pushed} pushed, ${run.deleted} deleted, ${run.conflicts.length} conflicts.`,
      );
    });
  }

  async function resolveConflict(conflict: SyncConflict, choice: AppleConflictChoice): Promise<void> {
    await runAction('Resolving conflict…', async () => {
      const getCalendar = bridge.getCalendar;
      const saveCalendar = bridge.saveCalendar;
      const getSyncState = bridge.getSyncState;
      const saveSyncState = bridge.saveSyncState;
      const getCredentials = bridge.getAppleCredentials;
      if (!getCalendar || !saveCalendar || !getSyncState || !saveSyncState || !getCredentials) {
        throw new Error('Apple sync is unavailable in this version.');
      }
      await resolveAppleConflict(
        { getCalendar, saveCalendar, getSyncState, saveSyncState, getCredentials },
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
    ? 'Apple sync status is unavailable.'
    : status.signedIn
      ? 'Signed in with Apple.'
      : status.configured
        ? 'Apple ID saved. Enter your app-specific password to sign in again.'
        : 'Apple sync is not set up yet.';

  return (
    <section aria-labelledby="apple-sync-heading">
      <h2 id="apple-sync-heading">Apple Calendar sync</h2>
      {error && <p role="alert">{error}</p>}
      {(busy ?? message) && <p role="status">{busy ?? message}</p>}
      <p>{statusText}</p>
      <p>
        To keep your calendar offline instead of syncing, use the Keep calendar offline control in
        the Google Calendar sync section above: it turns off sync for every provider.
      </p>
      {!status?.signedIn && (
        <div>
          <p>
            Generate an app-specific password at appleid.apple.com (Sign-In and Security, then
            App-Specific Passwords) and enter it here with your Apple ID. Never enter your main
            Apple ID password: the app-specific password is stored encrypted on this device and
            can be revoked any time from the same Apple ID page.
          </p>
          <div>
            <label htmlFor="apple-id">Apple ID</label>
            <input
              id="apple-id"
              type="text"
              value={appleId}
              onChange={(event) => setAppleId(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <div>
            <label htmlFor="apple-app-password">App-specific password</label>
            <input
              id="apple-app-password"
              type="password"
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <button type="button" onClick={() => void saveSignIn()} disabled={busy !== null}>
            Save Apple sign-in
          </button>
        </div>
      )}
      {status?.signedIn && (
        <div>
          <button type="button" onClick={() => void syncNow()} disabled={busy !== null}>
            Sync now
          </button>
          <button type="button" onClick={() => void signOut()} disabled={busy !== null}>
            Sign out
          </button>
          {bridge.listAppleCalendars &&
            bridge.getSyncState &&
            bridge.saveSyncState &&
            bridge.getCalendar &&
            bridge.saveCalendar && (
              <div>
                <p>
                  {savedPick
                    ? `Syncing with "${savedPick.name}".`
                    : 'Syncing with the first calendar found in the account.'}
                </p>
                <button type="button" onClick={() => void loadCalendars()} disabled={busy !== null}>
                  Choose Apple calendar
                </button>
                {calendars && (
                  <div>
                    <label htmlFor="apple-calendar-choice">Apple calendar</label>
                    <select
                      id="apple-calendar-choice"
                      value={pickedUrl}
                      onChange={(event) => {
                        setPickedUrl(event.target.value);
                        setConfirmingSwitch(false);
                      }}
                      disabled={busy !== null}
                    >
                      {calendars.map((calendar) => (
                        <option key={calendar.url} value={calendar.url}>
                          {calendar.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => void savePick()} disabled={busy !== null}>
                      Save calendar choice
                    </button>
                    {confirmingSwitch && (
                      <div>
                        <button
                          type="button"
                          onClick={() => void savePick()}
                          disabled={busy !== null}
                        >
                          Confirm calendar switch
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingSwitch(false);
                            setMessage('');
                          }}
                          disabled={busy !== null}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
      )}
      {result && result.conflicts.length > 0 && (
        <div>
          <p>
            These appointments changed both locally and in Apple, so the local version was kept.
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
          providerLabel="Apple"
        />
      )}
    </section>
  );
}
