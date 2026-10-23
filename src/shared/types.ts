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
  /** Missing metadata and externally replaced files are conservatively unknown. */
  provenance?: 'created' | 'imported' | 'unknown';
}

/** A library the user has opened before, offered in the recent-library picker. */
export interface RecentLibrary {
  path: string;
  name: string;
  lastOpenedAt: string;
}

/** Public view of the currently open local vault. */
export interface VaultInfo {
  name: string;
  path: string;
  entries: VaultEntry[];
}

/** A checkbox task parsed from Markdown or a semantic HTML checklist. */
export interface VaultTask {
  id: string;
  path: string;
  line?: number;
  taskId?: string;
  htmlTask?: boolean;
  revision?: string;
  remindAt?: string;
  text: string;
  complete: boolean;
  dueDate?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface VaultCaptureResult {
  vault: VaultInfo;
  notePath: string;
  omittedImages: number;
}

/** One Markdown reference and its best-effort resolution in the open vault. */
export interface VaultLink {
  sourcePath: string;
  targetPath?: string;
  targetTitle: string;
  resolved: boolean;
  attachment: boolean;
}

/** Current vault-wide forward links, backlinks, and unresolved references. */
export interface VaultLinkIndex {
  links: VaultLink[];
}

/** A user bookmark that points to a note in a local vault. */
/** A position inside a note that a bookmark points at, beyond the file itself. */
export type BookmarkAnchor =
  | { kind: 'heading'; text: string; occurrence: number }
  | { kind: 'offset'; offset: number };

export interface VaultBookmark {
  id: string;
  path: string;
  title: string;
  created: string;
  anchor?: BookmarkAnchor;
}

/** The last reading position in a document, used to resume where the reader stopped. */
export interface ReadingPosition {
  path: string;
  /** EPUB CFI for ePub documents; empty when only the section is known. */
  cfi: string;
  sectionIndex: number;
  updated: string;
}
