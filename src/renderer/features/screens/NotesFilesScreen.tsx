import DetailsView, { type DetailsViewProps } from '../../components/DetailsView';
import type { VaultEntry } from '../../../shared/types';

type NotesFilesScreenProps = Omit<DetailsViewProps, 'label' | 'items' | 'emptyMessage'> & {
  entries: readonly VaultEntry[];
  hasLibrary: boolean;
  notebookPath?: string;
  creationDisabled?: boolean;
  title?: string;
  onNewNote?: () => void;
  onNewFromTemplate?: () => void;
  showCommandButtons?: boolean;
};

function flatten(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

export default function NotesFilesScreen({
  entries,
  hasLibrary,
  notebookPath,
  creationDisabled,
  title = 'Notes and Files',
  onNewNote,
  onNewFromTemplate,
  showCommandButtons = true,
  ...details
}: NotesFilesScreenProps) {
  const prefix = notebookPath ? `${notebookPath}/` : undefined;
  const notesAndFiles = flatten(entries).filter(
    (entry) => entry.kind !== 'notebook' && (!prefix || entry.path.startsWith(prefix)),
  );
  return (
    <section aria-labelledby="notes-files-heading">
      <h2 id="notes-files-heading">{title}</h2>
      {showCommandButtons && (
        <>
          <button
            type="button"
            disabled={!hasLibrary || creationDisabled || !notebookPath || !onNewNote}
            onClick={onNewNote}
          >
            New note
          </button>
          <button
            type="button"
            disabled={!hasLibrary || creationDisabled || !notebookPath || !onNewFromTemplate}
            onClick={onNewFromTemplate}
          >
            New note from template
          </button>
        </>
      )}
      {!hasLibrary ? (
        <p>Open a library and select a notebook to create notes.</p>
      ) : !notebookPath ? (
        <p>Select a notebook to create notes. Showing all notes and files in this library.</p>
      ) : null}
      {notebookPath ? <p>Items in {notebookPath}</p> : null}
      <DetailsView
        {...details}
        label="Notes and files"
        items={notesAndFiles}
        emptyMessage={hasLibrary ? 'No notes or files in this library.' : 'Open a library to view notes and files.'}
      />
    </section>
  );
}
