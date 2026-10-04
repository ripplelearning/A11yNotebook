import { useId, useState } from 'react';
import Modal from '../../components/Modal';
import {
  BUILT_IN_TEMPLATES,
  expandTemplate,
  templateNotePath,
  validateNoteTitle,
  type NoteTemplate,
} from '../../../shared/templates';

export interface TemplateNotebook {
  path: string;
  name: string;
}

export interface NewFromTemplateDialogProps {
  notebooks: TemplateNotebook[];
  onCreate: (path: string, content: string, cursor: number) => void | Promise<void>;
  onClose: () => void;
  /** Additional templates read by the host; built-ins are always available. IDs must be unique. */
  templates?: NoteTemplate[];
  now?: Date;
}

export default function NewFromTemplateDialog({
  notebooks,
  onCreate,
  onClose,
  templates = [],
  now,
}: NewFromTemplateDialogProps) {
  const id = useId();
  const availableTemplates = [...BUILT_IN_TEMPLATES, ...templates];
  const [templateId, setTemplateId] = useState(availableTemplates[0].id);
  const [notebookPath, setNotebookPath] = useState(notebooks[0]?.path ?? '');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [openedAt] = useState(() => now ?? new Date());
  const template = availableTemplates.find((item) => item.id === templateId) ?? availableTemplates[0];
  const notebook = notebooks.find((item) => item.path === notebookPath);
  const expanded = expandTemplate(template.content, {
    title: title.trim().replace(/\.md$/i, '') || 'Untitled',
    notebook: notebook?.name ?? '',
    now: openedAt,
  });

  async function create() {
    const validationError = validateNoteTitle(title);
    if (validationError || !notebook) {
      setError(validationError ?? 'Choose a notebook.');
      return;
    }
    setError('');
    setCreating(true);
    try {
      await onCreate(templateNotePath(notebook.path, title), expanded.content, expanded.cursor);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the note.');
      setCreating(false);
    }
  }

  return (
    <Modal
      titleId={`${id}-title`}
      title="New note from template"
      className="wide-modal"
      onClose={() => {
        if (!creating) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!creating) void create();
        }}
        aria-busy={creating}
      >
        <div className="modal-body">
          <label htmlFor={`${id}-template`}>Template</label>
          <select
            id={`${id}-template`}
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            disabled={creating}
          >
            {availableTemplates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-notebook`}>Notebook</label>
          <select
            id={`${id}-notebook`}
            value={notebookPath}
            onChange={(event) => setNotebookPath(event.target.value)}
            disabled={creating || notebooks.length === 0}
          >
            {notebooks.length === 0 && <option value="">No notebooks available</option>}
            {notebooks.map((item) => (
              <option key={item.path} value={item.path}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-name`}>Note title</label>
          <input
            id={`${id}-name`}
            data-autofocus
            value={title}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error)}
            disabled={creating}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor={`${id}-preview`}>Markdown preview</label>
          <textarea id={`${id}-preview`} rows={12} readOnly value={expanded.content} />
          {error && (
            <p id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="submit" disabled={creating || notebooks.length === 0}>
            {creating ? 'Creating…' : 'Create note'}
          </button>
          <button type="button" onClick={onClose} disabled={creating}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
