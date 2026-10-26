import {
  applySync,
  classifyRemote,
  localChangesSince,
  pruneTombstones,
  type SyncConflict,
  type SyncProvider,
  type SyncStateFile,
} from './calendar-sync';
import type { AppointmentInput, CalendarAppointment } from './calendar';

/**
 * Provider-agnostic sync runner. It orchestrates one sync run for one
 * provider against injected storage callbacks and a provider transport, so
 * the same runner serves Google, Outlook, and Apple transports later.
 *
 * Atomicity boundary: remote applies, local pushes, and tombstone deletes
 * all happen in memory first; local storage and sync state are saved once
 * at the end. If any step throws, nothing is saved and the next run retries
 * cleanly. The one known crack: if the process dies after a provider create
 * but before the local save, the next run creates a second remote event
 * (the local copy still lacks the external id). The window is milliseconds
 * and the duplicate is user-deletable; it is not silently merged.
 *
 * Rules the runner enforces:
 * - A pending local delete wins over a remote upsert for the same event:
 *   the upsert is skipped instead of resurrecting the appointment.
 * - Conflicted local items are never pushed until the user resolves them.
 * - Items the remote touched this run are never pushed back (redundant).
 * - Matching is by provider external id only. On a first sync, an event
 *   that already exists both locally and remotely with no link between
 *   them will appear twice; the engine does not guess matches.
 * - Link-only edits never push: links are local-only and excluded from
 *   content comparison, so they do not restamp.
 * - Tombstones for the run's provider (or legacy tombstones with no
 *   provider) are cleared; other providers' tombstones are kept.
 */

export class SyncTokenExpiredError extends Error {
  constructor() {
    super('Provider sync token expired; a full pull is required.');
    this.name = 'SyncTokenExpiredError';
  }
}

export type PulledChange =
  | { kind: 'upsert'; appointment: AppointmentInput }
  | { kind: 'deleted'; externalId: string };

export interface ProviderTransport {
  pull(syncToken?: string): Promise<{ changes: PulledChange[]; syncToken?: string }>;
  pushCreate(appointment: CalendarAppointment): Promise<{ externalId: string; updatedAt?: string }>;
  pushUpdate(appointment: CalendarAppointment): Promise<{ updatedAt?: string }>;
  pushDelete(externalId: string): Promise<void>;
}

export interface SyncEngineDeps {
  provider: SyncProvider;
  loadLocal(): Promise<CalendarAppointment[]>;
  loadState(): Promise<SyncStateFile>;
  saveLocal(
    appointments: CalendarAppointment[],
    options?: { source?: 'local' | 'sync' },
  ): Promise<CalendarAppointment[]>;
  saveState(state: SyncStateFile): Promise<SyncStateFile>;
  transport: ProviderTransport;
  nowIso?: string;
}

export interface SyncRunResult {
  /** Remote changes pulled, including deletions. */
  pulled: number;
  /** Local creates and updates pushed. */
  pushed: number;
  /** Remote deletions applied plus tombstone deletes executed. */
  deleted: number;
  /** Conflicts left untouched for the user to resolve. */
  conflicts: SyncConflict[];
  syncToken?: string;
}

/**
 * Remote input shaped for classification. The id is a placeholder: applySync
 * assigns a fresh local id to remote-only items and keeps the local id for
 * remote-wins items, so the placeholder never survives.
 */
function asRemoteAppointment(input: AppointmentInput): CalendarAppointment {
  return { ...input, id: '' };
}

export async function runSync(deps: SyncEngineDeps): Promise<SyncRunResult> {
  const { provider, transport } = deps;
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const state = await deps.loadState();
  const local = await deps.loadLocal();
  const providerState = state.providers[provider] ?? { provider };
  const lastSyncAt = providerState.lastSyncAt;

  let pull: { changes: PulledChange[]; syncToken?: string };
  try {
    pull = await transport.pull(providerState.syncToken);
  } catch (error) {
    if (error instanceof SyncTokenExpiredError && providerState.syncToken) {
      pull = await transport.pull(undefined);
    } else {
      throw error;
    }
  }

  const tombstoneExternalIds = new Set(
    (state.tombstones ?? [])
      .filter(
        (tombstone) =>
          tombstone.externalId &&
          (tombstone.provider === provider || tombstone.provider === undefined),
      )
      .map((tombstone) => tombstone.externalId!),
  );
  const upserts = pull.changes.filter(
    (change): change is { kind: 'upsert'; appointment: AppointmentInput } =>
      change.kind === 'upsert' && !tombstoneExternalIds.has(change.appointment.externalId ?? ''),
  );
  const deletedExternalIds = new Set(
    pull.changes
      .filter((change) => change.kind === 'deleted')
      .map((change) => change.externalId),
  );

  const classified = classifyRemote(
    upserts.map((change) => asRemoteAppointment(change.appointment)),
    local,
    provider,
    lastSyncAt,
  );
  const localIdsBefore = new Set(local.map((item) => item.id));
  const { merged, conflicts } = applySync(local, classified);
  // Remote-only inserts get fresh local ids, so they are not in the
  // classified local set; recognize them by their new ids instead.
  const remoteInsertedIds = new Set(
    merged.filter((item) => !localIdsBefore.has(item.id)).map((item) => item.id),
  );

  const beforeDelete = merged.length;
  const afterRemoteDeletes = merged.filter(
    (item) =>
      !(item.provider === provider && item.externalId && deletedExternalIds.has(item.externalId)),
  );
  const remoteDeletedCount = beforeDelete - afterRemoteDeletes.length;

  // Work on copies: merged still references the caller's loaded objects for
  // untouched items, and pushes below attach external ids.
  const working = afterRemoteDeletes.map((item) => ({ ...item }));

  const classifiedLocalIds = new Set(
    classified
      .map((entry) => entry.local?.id)
      .filter((id): id is string => id !== undefined),
  );
  const conflictLocalIds = new Set(conflicts.map((conflict) => conflict.local.id));
  const pushCandidates = localChangesSince(
    working.filter(
      (item) =>
        !classifiedLocalIds.has(item.id) &&
        !remoteInsertedIds.has(item.id) &&
        !conflictLocalIds.has(item.id),
    ),
    lastSyncAt,
  );
  let pushed = 0;
  for (const item of pushCandidates) {
    if (item.externalId) {
      await transport.pushUpdate(item);
    } else {
      const created = await transport.pushCreate(item);
      item.externalId = created.externalId;
      item.provider = provider;
    }
    pushed += 1;
  }

  const prunedTombstones = pruneTombstones(state.tombstones ?? [], working);
  let tombstoneDeleted = 0;
  // Only other providers' tombstones survive: run-provider tombstones are
  // deleted remotely below (or were never synced), and legacy tombstones
  // with no provider have nothing actionable to delete.
  const remainingTombstones = prunedTombstones.filter(
    (tombstone) => tombstone.provider !== undefined && tombstone.provider !== provider,
  );
  for (const tombstone of prunedTombstones) {
    if (tombstone.provider === provider && tombstone.externalId) {
      await transport.pushDelete(tombstone.externalId);
      tombstoneDeleted += 1;
    }
  }

  await deps.saveLocal(working, { source: 'sync' });
  const nextSyncToken = pull.syncToken ?? providerState.syncToken;
  await deps.saveState({
    version: 1,
    providers: {
      ...(state.providers ?? {}),
      [provider]: {
        provider,
        lastSyncAt: nowIso,
        ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
      },
    },
    tombstones: remainingTombstones,
  });

  return {
    pulled: pull.changes.length,
    pushed,
    deleted: remoteDeletedCount + tombstoneDeleted,
    conflicts,
    ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
  };
}
