/**
 * Stores that can live under encrypted metadata protection. The base
 * pair (annotations, checkpoints) is migrated by the original opt-in;
 * the remaining stores are migrated individually by the extension
 * flow as each store's writers are routed through the protected
 * store. A library's pointer only lists the stores it has migrated —
 * any store absent from the pointer remains plaintext by design and
 * must never be read through the protected store.
 */
export const PROTECTED_STORE_NAMES = [
  'annotations',
  'checkpoints',
  'reminder-defaults',
  'image-alts',
  'bookmarks',
  'bibliography',
  'calendar',
  'links',
  'reminders',
  'settings',
  'search-index',
  'flashcard-schedules',
] as const;

export type ProtectedStoreName = (typeof PROTECTED_STORE_NAMES)[number];

/** Stores migrated together by the original protection opt-in. */
export const BASE_PROTECTED_STORES: readonly ProtectedStoreName[] = ['annotations', 'checkpoints'];

export interface ProtectedStorePointer {
  generation: string;
  digest: string;
  cleanupRequired: boolean;
}

export interface MetadataProtectionPointer {
  version: 1;
  vaultId: string;
  stores: Partial<Record<ProtectedStoreName, ProtectedStorePointer>>;
}

export interface MetadataProtectionStatus {
  enabled: boolean;
  eligible: boolean;
  locked: boolean;
  cleanupRequired: boolean;
  /** Stores currently under protection; empty when protection is off. */
  protectedStores: ProtectedStoreName[];
}

export interface EnableMetadataProtectionInput {
  acknowledgeExclusions: true;
}

export interface ExtendMetadataProtectionInput {
  store: ProtectedStoreName;
  acknowledgeExclusions: true;
}

/** Stores the settings UI may offer for one-at-a-time extension. */
export const EXTENDABLE_PROTECTED_STORES: readonly ProtectedStoreName[] = [
  'reminder-defaults',
  'bookmarks',
  'links',
  'image-alts',
  'flashcard-schedules',
  'reminders',
  'settings',
  'search-index',
];
