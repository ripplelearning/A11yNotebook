import { GoogleTransport } from './google-transport';
import { runSync, type ProviderTransport, type SyncRunResult } from './calendar-sync-engine';
import type { CalendarAppointment } from './calendar';
import type { SyncStateFile } from './calendar-sync';

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
