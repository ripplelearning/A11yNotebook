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
  /** Receives the credentials plus the picked calendar URL, when one is saved. */
  createTransport?(options: AppleCredentials & { calendarUrl?: string }): ProviderTransport;
}

async function transportForRun(deps: AppleSyncDeps): Promise<ProviderTransport> {
  const credentials = await deps.getCredentials();
  const state = await deps.getSyncState();
  const calendarUrl = state.providers.apple?.calendarUrl;
  const options = calendarUrl ? { ...credentials, calendarUrl } : credentials;
  return deps.createTransport ? deps.createTransport(options) : new AppleTransport(options);
}

export async function runAppleSync(deps: AppleSyncDeps): Promise<SyncRunResult> {
  const transport = await transportForRun(deps);
  const result = await runSync({
    provider: 'apple',
    loadLocal: deps.getCalendar,
    loadState: deps.getSyncState,
    saveLocal: deps.saveCalendar,
    saveState: deps.saveSyncState,
    transport,
  });
  // Record the calendar a discovery-based run used, so the picker shows
  // the current calendar (and picking it again is a no-op instead of
  // needlessly unlinking). Never overwrites an explicit pick, and never
  // touches the sync token or timestamp.
  if (transport instanceof AppleTransport) {
    const resolved = transport.resolvedCalendarInfo();
    if (resolved) {
      const current = await deps.getSyncState();
      const apple = current.providers.apple;
      if (!apple?.calendarUrl) {
        await deps.saveSyncState({
          ...current,
          providers: {
            ...current.providers,
            apple: {
              ...apple,
              provider: 'apple',
              calendarUrl: resolved.url,
              calendarName: resolved.displayName,
            },
          },
        });
      }
    }
  }
  return result;
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
  const transport = await transportForRun(deps);
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
