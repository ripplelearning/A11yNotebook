import type { CalendarAppointment, CalendarSyncProvider } from './calendar';

/**
 * Auth-independent core of two-way calendar sync. Sync works on appointment
 * series (the stored appointment), not on expanded occurrences; each provider
 * adapter translates between a series and the provider's own event shape.
 *
 * The app never stamped `updatedAt` before sync, so the sync layer stamps it
 * (UTC ISO, via `stampForSync`) whenever it saves. Change detection treats a
 * missing or unparseable `updatedAt` as changed: the safe default is to
 * upload it, never to silently drop it.
 */

export type SyncProvider = CalendarSyncProvider;

export interface ProviderSyncState {
  provider: SyncProvider;
  /** UTC ISO timestamp of the last completed sync with this provider. */
  lastSyncAt?: string;
  /** Opaque provider token (for example Google's nextSyncToken). */
  syncToken?: string;
  /**
   * Apple only: the picked calendar's CalDAV URL, saved by the calendar
   * picker. Absent means sync uses the first event calendar found.
   * The URL is a resource locator, not a credential; it lives in the
   * library's sync-state file alongside the sync token.
   */
  calendarUrl?: string;
  /** Apple only: the picked calendar's display name, for the picker UI. */
  calendarName?: string;
}

export interface SyncTombstone {
  /** Local appointment id that was deleted and still needs a remote delete. */
  id: string;
  /** UTC ISO timestamp of the local deletion. */
  deletedAt: string;
  /** Provider the deleted appointment was linked to, if any. */
  provider?: SyncProvider;
  /** Provider event id to delete, if the appointment was ever synced. */
  externalId?: string;
}

export interface SyncStateFile {
  version: 1;
  providers: Partial<Record<SyncProvider, ProviderSyncState>>;
  tombstones: SyncTombstone[];
}

const PROVIDERS: readonly SyncProvider[] = ['google', 'outlook', 'apple'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

/** Validate a stored sync-state file; malformed providers and tombstones drop. */
export function cleanSyncState(value: unknown): SyncStateFile {
  const empty: SyncStateFile = { version: 1, providers: {}, tombstones: [] };
  if (!isRecord(value)) return empty;
  const providers: Partial<Record<SyncProvider, ProviderSyncState>> = {};
  const rawProviders = isRecord(value.providers) ? value.providers : {};
  for (const provider of PROVIDERS) {
    const entry = rawProviders[provider];
    if (!isRecord(entry)) continue;
    const state: ProviderSyncState = { provider };
    if (isValidIso(entry.lastSyncAt)) state.lastSyncAt = entry.lastSyncAt;
    if (typeof entry.syncToken === 'string' && entry.syncToken) state.syncToken = entry.syncToken;
    if (typeof entry.calendarUrl === 'string' && entry.calendarUrl)
      state.calendarUrl = entry.calendarUrl;
    if (typeof entry.calendarName === 'string' && entry.calendarName)
      state.calendarName = entry.calendarName;
    providers[provider] = state;
  }
  const tombstones: SyncTombstone[] = [];
  if (Array.isArray(value.tombstones)) {
    const seen = new Set<string>();
    for (const entry of value.tombstones) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
      if (!isValidIso(entry.deletedAt)) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const tombstone: SyncTombstone = { id: entry.id, deletedAt: entry.deletedAt };
      if (typeof entry.provider === 'string' && (PROVIDERS as readonly string[]).includes(entry.provider)) {
        tombstone.provider = entry.provider as SyncProvider;
      }
      if (typeof entry.externalId === 'string' && entry.externalId) {
        tombstone.externalId = entry.externalId;
      }
      tombstones.push(tombstone);
    }
  }
  return { version: 1, providers, tombstones };
}

/** Stamp an appointment as just changed, preserving its id and sync links. */
export function stampForSync(
  appointment: CalendarAppointment,
  nowIso: string = new Date().toISOString(),
): CalendarAppointment {
  return { ...appointment, updatedAt: nowIso };
}

function changedSince(appointment: CalendarAppointment, lastSyncAt?: string): boolean {
  if (!lastSyncAt) return true;
  if (!appointment.updatedAt) return true;
  const updated = Date.parse(appointment.updatedAt);
  const since = Date.parse(lastSyncAt);
  if (Number.isNaN(updated) || Number.isNaN(since)) return true;
  return updated > since;
}

/** Local appointments that changed since the last sync (or all, on first sync). */
export function localChangesSince(
  appointments: CalendarAppointment[],
  lastSyncAt?: string,
): CalendarAppointment[] {
  return appointments.filter((item) => changedSince(item, lastSyncAt));
}

/**
 * Meaningful appointment content, ignoring ids and sync bookkeeping. When a
 * field is added to CalendarAppointment, add it here if it should count
 * toward a conflict. The link is deliberately excluded: links are local-only
 * metadata that providers never see, so a link edit must neither trigger a
 * push nor count as a conflicting change.
 */
export function sameAppointmentContent(a: CalendarAppointment, b: CalendarAppointment): boolean {
  return contentOf(a) === contentOf(b);
}

function contentOf(appointment: CalendarAppointment): string {
  return JSON.stringify({
    title: appointment.title,
    start: appointment.start,
    end: appointment.end,
    allDay: appointment.allDay,
    description: appointment.description,
    location: appointment.location,
    recurrence: appointment.recurrence,
  });
}

export type RemoteClassification = 'remoteOnly' | 'remoteWins' | 'unchanged' | 'conflict';

export interface ClassifiedRemote {
  remote: CalendarAppointment;
  local?: CalendarAppointment;
  classification: RemoteClassification;
}

/**
 * Classify each remote appointment against the local list. Adapters return
 * remote items with `provider` and `externalId` set to the provider's event
 * id; matching is by that external id, never by the local id. A remote change
 * conflicts only when the local copy also changed since the last sync and
 * the content actually differs; identical content is not a conflict even
 * when both sides were re-stamped.
 */
export function classifyRemote(
  remote: CalendarAppointment[],
  local: CalendarAppointment[],
  provider: SyncProvider,
  lastSyncAt?: string,
): ClassifiedRemote[] {
  const byExternalId = new Map<string, CalendarAppointment>();
  for (const item of local) {
    if (item.provider === provider && item.externalId) byExternalId.set(item.externalId, item);
  }
  return remote.map((remoteItem) => {
    const localItem =
      remoteItem.provider === provider && remoteItem.externalId
        ? byExternalId.get(remoteItem.externalId)
        : undefined;
    if (!localItem) return { remote: remoteItem, classification: 'remoteOnly' as const };
    const remoteChanged = changedSince(remoteItem, lastSyncAt);
    const localChanged = changedSince(localItem, lastSyncAt);
    if (!remoteChanged) return { remote: remoteItem, local: localItem, classification: 'unchanged' as const };
    if (!localChanged) return { remote: remoteItem, local: localItem, classification: 'remoteWins' as const };
    if (contentOf(remoteItem) === contentOf(localItem)) {
      return { remote: remoteItem, local: localItem, classification: 'unchanged' as const };
    }
    return { remote: remoteItem, local: localItem, classification: 'conflict' as const };
  });
}

export interface SyncConflict {
  local: CalendarAppointment;
  remote: CalendarAppointment;
}

/**
 * Apply classified remote changes to the local list. Remote-only items are
 * added and remote-wins items replace their local copy (keeping the local id,
 * the provider link, and the local-only link, which providers never carry).
 * Conflicts are left untouched locally and returned for the user to resolve;
 * nothing is silently overwritten.
 */
export function applySync(
  local: CalendarAppointment[],
  classified: ClassifiedRemote[],
): { merged: CalendarAppointment[]; conflicts: SyncConflict[] } {
  const merged = [...local];
  const conflicts: SyncConflict[] = [];
  for (const entry of classified) {
    if (entry.classification === 'unchanged') continue;
    if (entry.classification === 'conflict' && entry.local) {
      conflicts.push({ local: entry.local, remote: entry.remote });
      continue;
    }
    if (entry.classification === 'remoteOnly') {
      // Remote-only items get a fresh local id; the provider link is kept
      // so the next sync matches them instead of duplicating them.
      merged.push({ ...entry.remote, id: crypto.randomUUID() });
      continue;
    }
    if (entry.classification === 'remoteWins' && entry.local) {
      const index = merged.findIndex((item) => item.id === entry.local!.id);
      if (index >= 0) {
        merged[index] = {
          ...entry.remote,
          id: entry.local.id,
          provider: entry.local.provider,
          externalId: entry.local.externalId,
          ...(entry.local.link ? { link: entry.local.link } : {}),
          // Reminders are local-only like links: a remote win must not
          // silently drop the reminder the user set on this appointment.
          ...(entry.local.reminderMinutesBefore !== undefined
            ? { reminderMinutesBefore: entry.local.reminderMinutesBefore }
            : {}),
        };
      }
    }
  }
  return { merged, conflicts };
}

/** Drop tombstones for appointments that exist locally again (re-created). */
export function pruneTombstones(
  tombstones: SyncTombstone[],
  local: CalendarAppointment[],
): SyncTombstone[] {
  const localIds = new Set(local.map((item) => item.id));
  return tombstones.filter((tombstone) => !localIds.has(tombstone.id));
}
