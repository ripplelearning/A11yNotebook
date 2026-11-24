import { useId, useState } from 'react';
import Modal from '../../components/Modal';
import { templateNotePath, validateNoteTitle } from '../../../shared/templates';

export interface FilledCopyDialogProps {
  /** Display name of the source template, e.g. "Intake". */
  templateName: string;
  /** Note name prefilled in the dialog (the template's title). */
  defaultName: string;
  /** Notebook paths the copy can be saved into; '' is the library root. */
  notebooks: string[];
  initialNotebookPath?: string;
  /** Format of the template note; preselected as the copy's format. */
  sourceFormat: 'markdown' | 'html';
  onCreate: (path: string, format: 'markdown' | 'html') => void | Promise<void>;
  onClose: () => void;
}

/**
 * Saving a filled-in template note never changes the template: it
 * creates a new filled note instead. This dialog asks which format to
 * save the copy as, where to save it, and the file name / note name to
 * use. The caller bakes the typed field values into the copy.
 */
export default function FilledCopyDialog({
  templateName,
  defaultName,
  notebooks,
  initialNotebookPath,
  sourceFormat,
  onCreate,
  onClose,
}: FilledCopyDialogProps) {
  const id = useId();
  const [format, setFormat] = useState<'markdown' | 'html'>(sourceFormat);
  const [notebookPath, setNotebookPath] = useState(initialNotebookPath ?? notebooks[0] ?? '');
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    const validationError = validateNoteTitle(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setCreating(true);
    try {
      await onCreate(templateNotePath(notebookPath, name, format), format);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the filled copy.');
      setCreating(false);
    }
  }

  return (
    <Modal
      titleId={`${id}-title`}
      title="Save filled copy"
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
          <p>
            {`“${templateName}” is a template, so filling it in never changes the template itself. ` +
              'Save your filled-in answers as a new note instead.'}
          </p>
          <label htmlFor={`${id}-format`}>Format</label>
          <select
            id={`${id}-format`}
            value={format}
            onChange={(event) => setFormat(event.target.value as 'markdown' | 'html')}
            disabled={creating}
          >
            <option value="markdown">Markdown (.md)</option>
            <option value="html">HTML (.html)</option>
          </select>
          <label htmlFor={`${id}-notebook`}>Save in</label>
          <select
            id={`${id}-notebook`}
            value={notebookPath}
            onChange={(event) => setNotebookPath(event.target.value)}
            disabled={creating}
          >
            <option value="">Library root</option>
            {notebooks.map((notebook) => (
              <option key={notebook} value={notebook}>
                {notebook}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-name`}>Note name</label>
          <input
            id={`${id}-name`}
            data-autofocus
            value={name}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error)}
            disabled={creating}
            onChange={(event) => setName(event.target.value)}
          />
          {error && (
            <p id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Save filled copy'}
          </button>
          <button type="button" onClick={onClose} disabled={creating}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
