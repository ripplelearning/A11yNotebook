export type AppMode = 'read-only' | 'edit';

export type FocusRegion = 'navigation' | 'main' | 'tabs' | 'right-pane' | 'status';

/** Anything the shell can programmatically move focus to. */
export type FocusTarget = FocusRegion | 'search';

export interface Vault {
  id: string;
  name: string;
  description: string;
}

export interface Notebook {
  id: string;
  name: string;
  documents: DocumentResource[];
}

export interface DocumentResource {
  id: string;
  title: string;
  summary: string;
  content: string;
}

export interface NoteItem {
  id: string;
  label: string;
  summary: string;
}

/** A filesystem entry returned to the renderer without exposing Node objects. */
export interface VaultEntry {
  name: string;
  path: string;
  kind: 'notebook' | 'note' | 'attachment';
  children?: VaultEntry[];
}

/** Public view of the currently open local vault. */
export interface VaultInfo {
  name: string;
  path: string;
  entries: VaultEntry[];
}

/** A checkbox task parsed from one Markdown line in the open vault. */
export interface VaultTask {
  id: string;
  path: string;
  line: number;
  text: string;
  complete: boolean;
  dueDate?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}
