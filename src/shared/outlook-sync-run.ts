import { OutlookTransport } from './outlook-transport';
import { runSync, type ProviderTransport, type SyncRunResult } from './calendar-sync-engine';
import type { CalendarAppointment } from './calendar';
import type { SyncConflict, SyncStateFile } from './calendar-sync';

/**
 * One Outlook sync run, wired to storage callbacks (in the app, the vault
 * bridge methods). The transport factory is injectable so tests can run
 * the whole orchestration without network; production uses
 * OutlookTransport with a fresh access token from the main process.
 */
export interface OutlookSyncDeps {
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

export async function runOutlookSync(deps: OutlookSyncDeps): Promise<SyncRunResult> {
  const accessToken = await deps.getAccessToken();
  const transport = deps.createTransport
    ? deps.createTransport(accessToken)
    : new OutlookTransport({ accessToken });
  return runSync({
    provider: 'outlook',
    loadLocal: deps.getCalendar,
    loadState: deps.getSyncState,
    saveLocal: deps.saveCalendar,
    saveState: deps.saveSyncState,
    transport,
  });
}

export type OutlookConflictChoice = 'local' | 'remote';

/**
 * Resolve one Outlook sync conflict. Same convergence contract as Google:
 * keeping local pushes the local version to Outlook, and taking Outlook
 * saves the remote version locally with source 'sync' (no restamp,
 * local-only link and reminder kept). Sync state is untouched here; the
 * next sync run advances it once the resolved appointment classifies
 * unchanged.
 */
export async function resolveOutlookConflict(
  deps: OutlookSyncDeps,
  conflict: SyncConflict,
  choice: OutlookConflictChoice,
): Promise<void> {
  const accessToken = await deps.getAccessToken();
  const transport = deps.createTransport
    ? deps.createTransport(accessToken)
    : new OutlookTransport({ accessToken });
  if (choice === 'local') {
    if (!conflict.local.externalId) {
      throw new Error('This appointment is not linked to an Outlook event.');
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
