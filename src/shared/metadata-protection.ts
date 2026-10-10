export type ProtectedStoreName = 'annotations' | 'checkpoints';

export interface MetadataProtectionPointer {
  version: 1;
  vaultId: string;
  stores: Record<ProtectedStoreName, { generation: string; digest: string; cleanupRequired: boolean }>;
}

export interface MetadataProtectionStatus {
  enabled: boolean;
  eligible: boolean;
  locked: boolean;
  cleanupRequired: boolean;
}

export interface EnableMetadataProtectionInput {
  acknowledgeExclusions: true;
}
