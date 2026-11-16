export interface OpenNote {
  id: string;
  path: string;
  title: string;
  content: string;
  saved: string;
  /** Absolute path of the original file, when this note is an Alius. */
  aliusTarget?: string;
}

export interface NoteConflict {
  path: string;
  disk: string | null;
  /** Absolute path of the original file, when the conflicted note is an Alius. */
  aliusTarget?: string;
}
