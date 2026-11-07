import { useState } from 'react';
import Modal from '../../components/Modal';

interface QuickTaskDialogProps {
  onCreate: (text: string, notebookPath: string | undefined) => Promise<void>;
  onClose: () => void;
  /** The notebook the task goes to when there is no chooser (a notebook is already open). */
  notebookPath?: string;
  /**
   * When set, a notebook chooser appears after the text box, in the same
   * dialog, so the task can be jotted down first and the destination
   * picked (or left on the most recent notebook) second.
   */
  notebooks?: { path: string; name: string }[];
  /**
   * The chooser's initial value: the most recent notebook. Undefined
   * when there is no default — then a notebook must be picked before
   * saving. An empty string in the chooser means the library root.
   */
  defaultNotebookPath?: string;
}

/**
 * The Quick Task dialog: a Quick Task text box first (focused on open),
 * then — when no notebook is open — a notebook chooser in the same flow,
 * then OK and Cancel. Saving without choosing uses the most recent
 * notebook; OK stays disabled until a notebook is picked when there is
 * no default at all.
 */
export function QuickTaskDialog({ onCreate, onClose, notebookPath, notebooks, defaultNotebookPath }: QuickTaskDialogProps) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string | undefined>(defaultNotebookPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  const needsChoice = notebooks !== undefined && chosen === undefined;
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
          if (needsChoice) {
            setError('Choose a notebook.');
            return;
          }
          setBusy(true);
          setError('');
          const destination = notebooks ? (chosen === '' ? undefined : chosen) : notebookPath;
          void onCreate(text.trim(), destination)
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Quick Task
          <input data-autofocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        {notebooks ? (
          <label>
            Notebook
            <select
              value={chosen ?? '__choose__'}
              disabled={busy}
              onChange={(event) => setChosen(event.target.value)}
            >
              {chosen === undefined ? (
                <option value="__choose__" disabled>
                  Choose a notebook
                </option>
              ) : null}
              <option value="">Library root</option>
              {notebooks.map((notebook) => (
                <option key={notebook.path} value={notebook.path}>
                  {notebook.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default disabled={busy || needsChoice}>
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
