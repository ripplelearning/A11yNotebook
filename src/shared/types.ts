export type AppMode = 'read-only' | 'edit';

export type FocusRegion =
  | 'navigation'
  | 'main'
  | 'tabs'
  | 'right-pane'
  | 'status';

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
