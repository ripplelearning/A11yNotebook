import React, { useMemo } from 'react';
import type { VaultEntry, VaultInfo } from '../../../shared/types';
import DetailsView, { type Column } from '../../components/DetailsView';

interface NoteFileRow {
  id: string;
  name: string;
  path: string;
  kind: 'note' | 'attachment';
  format: string;
  notebook: string;
}

interface NotesFilesScreenProps {
  vault: VaultInfo | null;
  selectedNotebook: string | null;
  onSelectNotebook: (notebookPath: string | null) => void;
  onCreateNote: () => void;
  onOpenNote: (path: string) => void;
  onRenameNote: (path: string) => void;
  onDeleteNote?: (path: string) => void;
  onContextMenu?: (path?: string, invoker?: HTMLElement, pointer?: { x: number; y: number }) => void;
  onOpenLibrary: () => void;
}

function getFormat(name: string, kind: 'note' | 'attachment'): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'Markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'HTML';
  if (lower.endsWith('.txt')) return 'Plain Text';
  if (lower.endsWith('.pdf')) return 'PDF Document';
  if (kind === 'attachment') return 'Attachment';
  return 'Note';
}

function getNotebookName(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length > 1) {
    return parts[0];
  }
  return 'Root';
}

function collectNotesAndFiles(entries: VaultEntry[], notebookFilter: string | null): NoteFileRow[] {
  const rows: NoteFileRow[] = [];

  function traverse(list: VaultEntry[], currentNotebook: string) {
    for (const entry of list) {
      if (entry.kind === 'notebook') {
        if (!notebookFilter || entry.path === notebookFilter || entry.path.startsWith(notebookFilter + '/')) {
          traverse(entry.children ?? [], entry.name);
        }
      } else {
        if (!notebookFilter || entry.path.startsWith(notebookFilter + '/') || currentNotebook === notebookFilter) {
          rows.push({
            id: entry.path,
            name: entry.name,
            path: entry.path,
            kind: entry.kind,
            format: getFormat(entry.name, entry.kind),
            notebook: currentNotebook || getNotebookName(entry.path),
          });
        }
      }
    }
  }

  traverse(entries, '');
  return rows;
}

const COLUMNS: Column<NoteFileRow>[] = [
  { id: 'name', header: 'Name', sortable: true, accessor: (row) => row.name },
  { id: 'format', header: 'Format', sortable: true, accessor: (row) => row.format },
  { id: 'notebook', header: 'Notebook', sortable: true, accessor: (row) => row.notebook },
  { id: 'path', header: 'Path', sortable: true, accessor: (row) => row.path },
];

export default function NotesFilesScreen({
  vault,
  selectedNotebook,
  onSelectNotebook,
  onCreateNote,
  onOpenNote,
  onRenameNote,
  onDeleteNote,
  onContextMenu,
  onOpenLibrary,
}: NotesFilesScreenProps) {
  const notebooks = useMemo(() => {
    if (!vault) return [];
    return vault.entries.filter((e) => e.kind === 'notebook');
  }, [vault]);

  const rows = useMemo(() => {
    if (!vault) return [];
    return collectNotesAndFiles(vault.entries, selectedNotebook);
  }, [vault, selectedNotebook]);

  if (!vault) {
    return (
      <section aria-labelledby="notes-files-heading" className="screen-container">
        <h2 id="notes-files-heading">Notes &amp; Files</h2>
        <div className="empty-state">
          <p>Open a library to view and manage notes and files.</p>
          <button type="button" onClick={onOpenLibrary}>
            Open library
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="notes-files-heading" className="screen-container">
      <div className="screen-header">
        <h2 id="notes-files-heading">Notes &amp; Files</h2>
        <div className="screen-actions">
          {notebooks.length > 0 && (
            <label htmlFor="notes-notebook-filter" className="screen-filter-label">
              Filter by notebook:{' '}
              <select
                id="notes-notebook-filter"
                value={selectedNotebook ?? ''}
                onChange={(e) => onSelectNotebook(e.target.value ? e.target.value : null)}
              >
                <option value="">All notebooks</option>
                {notebooks.map((nb) => (
                  <option key={nb.path} value={nb.path}>
                    {nb.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={onCreateNote}>
            New note
          </button>
        </div>
      </div>

      {rows.length > 0 ? (
        <DetailsView
          columns={COLUMNS}
          rows={rows}
          caption="Notes and files in current library"
          onActivate={(row) => onOpenNote(row.path)}
          onRename={(row) => onRenameNote(row.path)}
          onContextMenu={(row, invoker) => onContextMenu?.(row.path, invoker)}
        />
      ) : (
        <div className="empty-state">
          <p>
            {selectedNotebook
              ? 'No notes or files found in this notebook.'
              : 'No notes or files found in this library.'}
          </p>
          <button type="button" onClick={onCreateNote}>
            New note
          </button>
        </div>
      )}
    </section>
  );
}
