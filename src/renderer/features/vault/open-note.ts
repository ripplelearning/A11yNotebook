export interface OpenNote {
  id: string;
  path: string;
  title: string;
  content: string;
  saved: string;
}

export interface NoteConflict {
  path: string;
  disk: string | null;
}
