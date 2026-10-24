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
  // Notebooks are silos: without a selected notebook this view shows
  // nothing at all. Cross-notebook discovery happens through global
  // search, never by browsing an everything-in-the-library list.
  const notesAndFiles = prefix
    ? flatten(entries).filter((entry) => entry.kind !== 'notebook' && entry.path.startsWith(prefix))
    : [];
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
        <p>Select a notebook to see its notes and files. Each notebook shows only its own notes and files.</p>
      ) : null}
      {notebookPath ? <p>Items in {notebookPath}</p> : null}
      <DetailsView
        {...details}
        label="Notes and files"
        items={notesAndFiles}
        emptyMessage={
          !hasLibrary
            ? 'Open a library to view notes and files.'
            : notebookPath
              ? 'No notes or files in this notebook.'
              : 'Select a notebook to view its notes and files.'
        }
      />
    </section>
  );
}
