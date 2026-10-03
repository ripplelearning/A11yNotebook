import { useState } from 'react';
import { APP_NAME, REPOSITORY_URL } from '../../shared/app-info';
import { getKeyboardShortcuts } from '../../shared/command-registry';
import Modal from './Modal';

type DialogProps = { onClose: () => void };

const NAVIGATION_SHORTCUTS = [
  { label: 'Move to the next pane', shortcut: 'F6' },
  { label: 'Move to the previous pane', shortcut: 'Shift+F6' },
  { label: 'Move between open tabs', shortcut: 'Left Arrow / Right Arrow, Home, End' },
  { label: 'Close a dialog', shortcut: 'Escape' },
];

export function KeyboardShortcutsDialog({ onClose }: DialogProps) {
  const rows = [...NAVIGATION_SHORTCUTS, ...getKeyboardShortcuts()];
  return (
    <Modal titleId="shortcuts-dialog-title" title="Keyboard Shortcuts" onClose={onClose} className="wide-modal">
      <div className="modal-body table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Shortcut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.shortcut}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function AboutDialog({ onClose }: DialogProps) {
  return (
    <Modal
      titleId="about-dialog-title"
      title={`About ${APP_NAME}`}
      describedBy="about-dialog-summary"
      onClose={onClose}
    >
      <div className="modal-body">
        <p id="about-dialog-summary">
          {APP_NAME} version {__APP_VERSION__}. An accessibility-first personal knowledge notebook.
        </p>
        <p>
          Source code and releases:{' '}
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            {REPOSITORY_URL}
          </a>
        </p>
        <p>Released under the MIT License.</p>
      </div>
      <div className="modal-actions">
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

type NotebookNameDialogProps = {
  onCreate: (name: string) => void;
  onClose: () => void;
};

export function NotebookNameDialog({ onCreate, onClose }: NotebookNameDialogProps) {
  const [name, setName] = useState('');
  const trimmedName = name.trim();

  return (
    <Modal titleId="notebook-name-dialog-title" title="New notebook" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedName) onCreate(trimmedName);
        }}
      >
        <div className="modal-body">
          <label htmlFor="notebook-name">Notebook name</label>
          <input id="notebook-name" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!trimmedName}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
