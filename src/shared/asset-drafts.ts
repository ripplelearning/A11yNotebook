export const ASSET_DRAFT_MAX_BYTES = 2 * 1024 * 1024;
export const ASSET_DRAFT_MAX_RECORDS = 20;
export const ASSET_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AssetDraft {
  path: string;
  type: string;
  revision: string;
  updatedAt: string;
  expiresAt: string;
  baselineHash: string;
  baselineContent: string;
  content: string;
}

export interface AssetDraftInput {
  path: string;
  type: string;
  baselineContent: string;
  content: string;
}

export interface AssetDraftRecovery {
  enabled: boolean;
  token: string;
  draft: AssetDraft | null;
}
