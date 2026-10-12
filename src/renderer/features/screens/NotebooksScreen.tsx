import React from 'react';
import type { VaultInfo } from '../../../shared/types';
import DetailsView, { type Column } from '../../components/DetailsView';

interface NotebookRow {
  id: string;
  name: string;
  path: string;
  itemCount: number;
}

interface NotebooksScreenProps {
  vault: VaultInfo | null;
  onCreateNotebook: () => void;
  onOpenLibrary: () => void;
  onSelectNotebook: (notebookPath: string) => void;
  onRenameNotebook: (path: string) => void;
  onContextMenu?: (path?: string, invoker?: HTMLElement, pointer?: { x: number; y: number }) => void;
}

const COLUMNS: Column<NotebookRow>[] = [
  { id: 'name', header: 'Name', sortable: true, accessor: (row) => row.name },
  { id: 'path', header: 'Path', sortable: true, accessor: (row) => row.path },
  {
    id: 'itemCount',
    header: 'Items',
    sortable: true,
    accessor: (row) => row.itemCount,
    renderCell: (row) => `${row.itemCount} item${row.itemCount === 1 ? '' : 's'}`,
  },
];

export default function NotebooksScreen({
  vault,
  onCreateNotebook,
  onOpenLibrary,
  onSelectNotebook,
  onRenameNotebook,
  onContextMenu,
}: NotebooksScreenProps) {
  const notebooks = vault ? vault.entries.filter((entry) => entry.kind === 'notebook') : [];

  const rows: NotebookRow[] = notebooks.map((entry) => ({
    id: entry.path,
    name: entry.name,
    path: entry.path,
    itemCount: entry.children?.length ?? 0,
  }));

  if (!vault) {
    return (
      <section aria-labelledby="notebooks-heading" className="screen-container">
        <h2 id="notebooks-heading">Notebooks</h2>
        <div className="empty-state">
          <p>Open a library to view and manage notebooks.</p>
          <button type="button" onClick={onOpenLibrary}>
            Open library
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="notebooks-heading" className="screen-container">
      <div className="screen-header">
        <h2 id="notebooks-heading">Notebooks in {vault.name}</h2>
        <div className="screen-actions">
          <button type="button" onClick={onCreateNotebook}>
            New notebook
          </button>
        </div>
      </div>

      {rows.length > 0 ? (
        <DetailsView
          columns={COLUMNS}
          rows={rows}
          caption={`Notebooks in ${vault.name}`}
          onActivate={(row) => onSelectNotebook(row.path)}
          onRename={(row) => onRenameNotebook(row.path)}
          onContextMenu={(row, invoker) => onContextMenu?.(row.path, invoker)}
        />
      ) : (
        <div className="empty-state">
          <p>No notebooks found in this library.</p>
          <button type="button" onClick={onCreateNotebook}>
            New notebook
          </button>
        </div>
      )}
    </section>
  );
}
