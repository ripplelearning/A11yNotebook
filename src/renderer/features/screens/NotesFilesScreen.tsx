import DetailsView, { type DetailsViewProps } from '../../components/DetailsView';
import type { VaultEntry } from '../../../shared/types';

type NotesFilesScreenProps = Omit<DetailsViewProps, 'label' | 'items' | 'emptyMessage'> & {
  entries: readonly VaultEntry[];
  hasLibrary: boolean;
  notebookPath?: string;
};

function flatten(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

export default function NotesFilesScreen({ entries, hasLibrary, notebookPath, ...details }: NotesFilesScreenProps) {
  const prefix = notebookPath ? `${notebookPath}/` : undefined;
  const notesAndFiles = flatten(entries).filter(
    (entry) => entry.kind !== 'notebook' && (!prefix || entry.path.startsWith(prefix)),
  );
  return (
    <section aria-labelledby="notes-files-heading">
      <h2 id="notes-files-heading">Notes &amp; Files</h2>
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
