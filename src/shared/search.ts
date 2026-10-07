export interface VaultSearchQuery {
  text: string;
  notebook?: string;
  kind?: 'note' | 'attachment' | 'docx';
  tag?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  limit?: number;
}

export interface VaultSearchResult {
  path: string;
  title: string;
  kind: 'note' | 'attachment' | 'docx';
  notebook: string;
  tags: string[];
  modified: string;
  /** Plain text, never HTML; render as text rather than markup. */
  snippet: string;
  score: number;
}

export interface VaultChangedEvent {
  vaultPath: string;
  /** Vault-relative paths; an empty path means the whole vault may have changed. */
  paths: string[];
}
