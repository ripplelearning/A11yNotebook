import React from 'react';
import type { VaultInfo } from '../../../shared/types';
import DetailsView, { type Column } from '../../components/DetailsView';

interface LibraryRow {
  id: string;
  name: string;
  path: string;
  status: string;
}

interface LibrariesScreenProps {
  vault: VaultInfo | null;
  onOpenLibrary: () => void;
  onSelectLibrary: (vault: VaultInfo) => void;
  onContextMenu?: (path?: string, invoker?: HTMLElement, pointer?: { x: number; y: number }) => void;
}

const COLUMNS: Column<LibraryRow>[] = [
  { id: 'name', header: 'Name', sortable: true, accessor: (row) => row.name },
  { id: 'path', header: 'Path', sortable: true, accessor: (row) => row.path },
  { id: 'status', header: 'Status', sortable: true, accessor: (row) => row.status },
];

export default function LibrariesScreen({
  vault,
  onOpenLibrary,
  onSelectLibrary,
  onContextMenu,
}: LibrariesScreenProps) {
  const rows: LibraryRow[] = vault
    ? [
        {
          id: vault.path,
          name: vault.name,
          path: vault.path,
          status: 'Open',
        },
      ]
    : [];

  return (
    <section aria-labelledby="libraries-heading" className="screen-container">
      <div className="screen-header">
        <h2 id="libraries-heading">Libraries</h2>
        <div className="screen-actions">
          <button type="button" onClick={onOpenLibrary}>
            Open library
          </button>
        </div>
      </div>

      {rows.length > 0 ? (
        <DetailsView
          columns={COLUMNS}
          rows={rows}
          caption="Associated libraries"
          onActivate={(row) => {
            if (vault && row.path === vault.path) {
              onSelectLibrary(vault);
            }
          }}
          onContextMenu={(row, invoker) => {
            onContextMenu?.(row.path, invoker);
          }}
        />
      ) : (
        <div className="empty-state">
          <p>No library is currently open.</p>
          <button type="button" onClick={onOpenLibrary}>
            Open library
          </button>
        </div>
      )}
    </section>
  );
}
