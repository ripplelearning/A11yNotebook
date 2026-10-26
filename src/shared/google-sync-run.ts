import { GoogleTransport } from './google-transport';
import { runSync, type ProviderTransport, type SyncRunResult } from './calendar-sync-engine';
import type { CalendarAppointment } from './calendar';
import type { SyncConflict, SyncStateFile } from './calendar-sync';

/**
 * One Google sync run, wired to storage callbacks (in the app, the vault
 * bridge methods). The transport factory is injectable so tests can run
 * the whole orchestration without network; production uses GoogleTransport
 * with a fresh access token from the main process.
 */
export interface GoogleSyncDeps {
  getCalendar(): Promise<CalendarAppointment[]>;
  saveCalendar(
    appointments: CalendarAppointment[],
    options?: { source?: 'local' | 'sync' },
  ): Promise<CalendarAppointment[]>;
  getSyncState(): Promise<SyncStateFile>;
  saveSyncState(state: SyncStateFile): Promise<SyncStateFile>;
  getAccessToken(): Promise<string>;
  createTransport?(accessToken: string): ProviderTransport;
}

export async function runGoogleSync(deps: GoogleSyncDeps): Promise<SyncRunResult> {
  const accessToken = await deps.getAccessToken();
  const transport = deps.createTransport
    ? deps.createTransport(accessToken)
    : new GoogleTransport({ accessToken });
  return runSync({
    provider: 'google',
    loadLocal: deps.getCalendar,
    loadState: deps.getSyncState,
    saveLocal: deps.saveCalendar,
    saveState: deps.saveSyncState,
    transport,
  });
}

export type ConflictChoice = 'local' | 'remote';

/**
 * Resolve one sync conflict. Both choices converge, so the next sync
 * classifies the appointment unchanged instead of conflicting again:
 * keeping local pushes the local version to Google (the remote copy then
 * matches local), and taking Google saves the remote version locally
 * with source 'sync' (no restamp, local-only link and reminder kept).
 * Sync state is deliberately untouched here: the next sync run advances
 * it once the resolved appointment classifies unchanged.
 */
export async function resolveGoogleConflict(
  deps: GoogleSyncDeps,
  conflict: SyncConflict,
  choice: ConflictChoice,
): Promise<void> {
  const accessToken = await deps.getAccessToken();
  const transport = deps.createTransport
    ? deps.createTransport(accessToken)
    : new GoogleTransport({ accessToken });
  if (choice === 'local') {
    if (!conflict.local.externalId) {
      throw new Error('This appointment is not linked to a Google event.');
    }
    await transport.pushUpdate(conflict.local);
    return;
  }
  const local = await deps.getCalendar();
  const index = local.findIndex((item) => item.id === conflict.local.id);
  if (index < 0) throw new Error('This appointment no longer exists locally.');
  const next = [...local];
  next[index] = {
    ...conflict.remote,
    id: conflict.local.id,
    provider: conflict.local.provider,
    externalId: conflict.local.externalId,
    ...(conflict.local.link ? { link: conflict.local.link } : {}),
    ...(conflict.local.reminderMinutesBefore !== undefined
      ? { reminderMinutesBefore: conflict.local.reminderMinutesBefore }
      : {}),
  };
  await deps.saveCalendar(next, { source: 'sync' });
}
