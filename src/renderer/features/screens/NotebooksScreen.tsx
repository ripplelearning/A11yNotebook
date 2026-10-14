import DetailsView, { type DetailsViewProps } from '../../components/DetailsView';
import type { VaultEntry } from '../../../shared/types';

type NotebooksScreenProps = Omit<DetailsViewProps, 'label' | 'items' | 'emptyMessage'> & {
  entries: readonly VaultEntry[];
  hasLibrary: boolean;
};

function flatten(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

export default function NotebooksScreen({ entries, hasLibrary, ...details }: NotebooksScreenProps) {
  const notebooks = flatten(entries).filter((entry) => entry.kind === 'notebook');
  return (
    <section aria-labelledby="notebooks-heading">
      <h2 id="notebooks-heading">Notebooks</h2>
      <DetailsView
        {...details}
        label="Notebooks"
        items={notebooks}
        emptyMessage={hasLibrary ? 'No notebooks in this library.' : 'Open a library to view notebooks.'}
      />
    </section>
  );
}
