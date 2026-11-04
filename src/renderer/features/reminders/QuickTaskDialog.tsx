import { useState } from 'react';
import Modal from '../../components/Modal';

interface QuickTaskDialogProps {
  onCreate: (text: string) => Promise<void>;
  onClose: () => void;
}

/**
 * The Quick Task dialog: only a Quick Task text box, OK, and Cancel.
 * OK is first and default, so Enter while focused in the text box
 * activates it through native form submission.
 */
export function QuickTaskDialog({ onCreate, onClose }: QuickTaskDialogProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="Quick Task" titleId="quick-task-title" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!text.trim()) {
            setError('Enter task text.');
            return;
          }
          setBusy(true);
          setError('');
          void onCreate(text.trim())
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Quick Task
          <input data-autofocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default disabled={busy}>
          OK
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}

export interface RecentLibraryOption {
  path: string;
  name: string;
}

interface QuickTaskLibraryPickerProps {
  libraries: RecentLibraryOption[];
  onPick: (path: string) => void;
  onOpenLibrary: () => void;
  onClose: () => void;
}

/** First fallback step when no library is open: pick a recent library. */
export function QuickTaskLibraryPicker({ libraries, onPick, onOpenLibrary, onClose }: QuickTaskLibraryPickerProps) {
  const [path, setPath] = useState(libraries[0]?.path ?? '');
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="Quick Task library" titleId="quick-task-library-title" onClose={close}>
      {libraries.length ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !path) return;
            setBusy(true);
            onPick(path);
          }}
        >
          <label>
            Library
            <select data-autofocus value={path} disabled={busy} onChange={(event) => setPath(event.target.value)}>
              {libraries.map((library) => (
                <option key={library.path} value={library.path}>
                  {library.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" data-default disabled={busy || !path}>
            OK
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </form>
      ) : (
        <div>
          <p>No recent libraries yet. Open a library to add the Quick Task to it.</p>
          <button
            type="button"
            data-default
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onOpenLibrary();
            }}
          >
            Open library…
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      )}
    </Modal>
  );
}

interface QuickTaskNotebookPickerProps {
  notebooks: string[];
  onPick: (notebookPath: string | undefined) => void;
  onClose: () => void;
}

/** Second fallback step: pick a notebook in the newly opened library. */
export function QuickTaskNotebookPicker({ notebooks, onPick, onClose }: QuickTaskNotebookPickerProps) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="Quick Task notebook" titleId="quick-task-notebook-title" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          onPick(path || undefined);
        }}
      >
        <label>
          Notebook
          <select data-autofocus value={path} disabled={busy} onChange={(event) => setPath(event.target.value)}>
            <option value="">Library root</option>
            {notebooks.map((notebook) => (
              <option key={notebook} value={notebook}>
                {notebook}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" data-default disabled={busy}>
          OK
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
