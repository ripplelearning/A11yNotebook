import React from 'react';
import type { VaultInfo, VaultTask } from '../../../shared/types';

interface ContentsScreenProps {
  vault: VaultInfo | null;
  tasks: VaultTask[];
  onNavigate: (tabId: string) => void;
  onOpenLibrary: () => void;
  onCreateNotebook: () => void;
  onCreateNote: () => void;
}

export default function ContentsScreen({
  vault,
  tasks,
  onNavigate,
  onOpenLibrary,
  onCreateNotebook,
  onCreateNote,
}: ContentsScreenProps) {
  const notebookCount = vault ? vault.entries.filter((e) => e.kind === 'notebook').length : 0;
  const noteCount = vault
    ? vault.entries.reduce((acc, e) => {
        const countNotes = (entry: typeof e): number =>
          (entry.kind === 'note' ? 1 : 0) + (entry.children?.reduce((sum, c) => sum + countNotes(c), 0) ?? 0);
        return acc + countNotes(e);
      }, 0)
    : 0;
  const pendingTasksCount = tasks.filter((t) => !t.complete).length;

  return (
    <section aria-labelledby="contents-heading" className="screen-container contents-screen">
      <div className="screen-header">
        <h2 id="contents-heading">Contents &amp; Overview</h2>
      </div>

      <div className="contents-summary">
        <p>
          {vault ? (
            <>
              Active library: <strong>{vault.name}</strong> ({vault.path})
            </>
          ) : (
            'No library currently open.'
          )}
        </p>
      </div>

      <nav aria-label="Major sections" className="contents-nav-grid">
        <ul className="contents-list" role="list">
          <li>
            <button
              type="button"
              className="contents-nav-button"
              onClick={() => onNavigate('libraries')}
              aria-keyshortcuts="Control+1"
            >
              <span className="nav-title">1. Libraries</span>
              <span className="nav-desc">View and manage open and available libraries (Ctrl+1)</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="contents-nav-button"
              onClick={() => onNavigate('notebooks')}
              aria-keyshortcuts="Control+2"
            >
              <span className="nav-title">2. Notebooks ({notebookCount})</span>
              <span className="nav-desc">Browse notebooks in the current library (Ctrl+2)</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="contents-nav-button"
              onClick={() => onNavigate('notes-files')}
              aria-keyshortcuts="Control+3"
            >
              <span className="nav-title">3. Notes &amp; Files ({noteCount})</span>
              <span className="nav-desc">Structured list of notes and attachments (Ctrl+3)</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="contents-nav-button"
              onClick={() => onNavigate('tasks')}
              aria-keyshortcuts="Control+4"
            >
              <span className="nav-title">4. Tasks &amp; Reminders ({pendingTasksCount} pending)</span>
              <span className="nav-desc">Checklist tasks, reminders, and milestones (Ctrl+4)</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="contents-nav-button"
              onClick={() => onNavigate('assets')}
              aria-keyshortcuts="Control+5"
            >
              <span className="nav-title">5. Cognitive Assets</span>
              <span className="nav-desc">Manage citations, bibliographies, and cognitive artifacts (Ctrl+5)</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="contents-quick-actions">
        <h3>Quick Actions</h3>
        <div className="action-buttons">
          {!vault && (
            <button type="button" onClick={onOpenLibrary}>
              Open library…
            </button>
          )}
          {vault && (
            <>
              <button type="button" onClick={onCreateNote}>
                New note
              </button>
              <button type="button" onClick={onCreateNotebook}>
                New notebook
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
