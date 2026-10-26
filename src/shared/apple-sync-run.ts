import { AppleTransport, type AppleCredentials } from './apple-transport';
import { runSync, type ProviderTransport, type SyncRunResult } from './calendar-sync-engine';
import type { CalendarAppointment } from './calendar';
import type { SyncConflict, SyncStateFile } from './calendar-sync';

/**
 * One Apple sync run, wired to storage callbacks (in the app, the vault
 * bridge methods). The transport factory is injectable so tests can run
 * the whole orchestration without network; production uses
 * AppleTransport with the saved Apple ID and app-specific password from
 * the main process. The password lives in renderer memory only for
 * this run.
 */
export interface AppleSyncDeps {
  getCalendar(): Promise<CalendarAppointment[]>;
  saveCalendar(
    appointments: CalendarAppointment[],
    options?: { source?: 'local' | 'sync' },
  ): Promise<CalendarAppointment[]>;
  getSyncState(): Promise<SyncStateFile>;
  saveSyncState(state: SyncStateFile): Promise<SyncStateFile>;
  getCredentials(): Promise<AppleCredentials>;
  createTransport?(credentials: AppleCredentials): ProviderTransport;
}

export async function runAppleSync(deps: AppleSyncDeps): Promise<SyncRunResult> {
  const credentials = await deps.getCredentials();
  const transport = deps.createTransport
    ? deps.createTransport(credentials)
    : new AppleTransport({ ...credentials });
  return runSync({
    provider: 'apple',
    loadLocal: deps.getCalendar,
    loadState: deps.getSyncState,
    saveLocal: deps.saveCalendar,
    saveState: deps.saveSyncState,
    transport,
  });
}

export type AppleConflictChoice = 'local' | 'remote';

/**
 * Resolve one Apple sync conflict. Same convergence contract as Google
 * and Outlook: keeping local pushes the local version to Apple, and
 * taking Apple saves the remote version locally with source 'sync' (no
 * restamp, local-only link and reminder kept). Sync state is untouched
 * here; the next sync run advances it once the resolved appointment
 * classifies unchanged.
 */
export async function resolveAppleConflict(
  deps: AppleSyncDeps,
  conflict: SyncConflict,
  choice: AppleConflictChoice,
): Promise<void> {
  const credentials = await deps.getCredentials();
  const transport = deps.createTransport
    ? deps.createTransport(credentials)
    : new AppleTransport({ ...credentials });
  if (choice === 'local') {
    if (!conflict.local.externalId) {
      throw new Error('This appointment is not linked to an Apple event.');
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
