import { useId, useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { convertNoteContent } from '../vault/format-conversion';
import { sanitizeNoteHtml } from '../vault/sanitize-html';
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
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [openedAt] = useState(() => now ?? new Date());
  const template = availableTemplates.find((item) => item.id === templateId) ?? availableTemplates[0];
  const notebook = notebooks.find((item) => item.path === notebookPath);
  const sourceFormat = template.format ?? 'markdown';
  const templateTitle = title.trim().replace(/\.(?:md|html)$/i, '') || 'Untitled';
  const previewPath = templateNotePath(
    notebookPath,
    validateNoteTitle(title) ? 'Untitled' : title || 'Untitled',
    format,
  );
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const expanded = expandTemplate(template.content, {
    title: sourceFormat === 'html' ? escapeHtml(templateTitle) : templateTitle,
    notebook: sourceFormat === 'html' ? escapeHtml(notebook?.name ?? '') : (notebook?.name ?? ''),
    now: openedAt,
  });
  const cursorMarker = 'A11YNOTEBOOKCURSORPOSITION7F41';
  const marked = `${expanded.content.slice(0, expanded.cursor)}${cursorMarker}${expanded.content.slice(expanded.cursor)}`;
  const rawContent = useMemo(
    () => (sourceFormat === format ? marked : convertNoteContent(marked, sourceFormat, format, previewPath)),
    [format, marked, previewPath, sourceFormat],
  );
  const safeContent = useMemo(
    () => (format === 'html' ? sanitizeNoteHtml(rawContent, previewPath) : rawContent),
    [format, previewPath, rawContent],
  );
  const markerPosition = safeContent.indexOf(cursorMarker);
  const previewContent =
    markerPosition < 0
      ? safeContent
      : `${safeContent.slice(0, markerPosition)}${safeContent.slice(markerPosition + cursorMarker.length)}`;
  const cursor = markerPosition < 0 ? previewContent.length : markerPosition;

  async function create() {
    const validationError = validateNoteTitle(title);
    if (validationError || !notebook) {
      setError(validationError ?? 'Choose a notebook.');
      return;
    }
    setError('');
    setCreating(true);
    try {
      await onCreate(templateNotePath(notebook.path, title, format), previewContent, cursor);
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
          <label htmlFor={`${id}-format`}>Output format</label>
          <select
            id={`${id}-format`}
            value={format}
            onChange={(event) => setFormat(event.target.value as 'markdown' | 'html')}
            disabled={creating}
          >
            <option value="markdown">Markdown (.md)</option>
            <option value="html">HTML (.html)</option>
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
          <label htmlFor={`${id}-preview`}>{format === 'html' ? 'HTML preview' : 'Markdown preview'}</label>
          <textarea id={`${id}-preview`} rows={12} readOnly value={previewContent} />
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
