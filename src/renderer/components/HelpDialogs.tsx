import { useState, type FormEvent } from 'react';
import { APP_NAME, REPOSITORY_URL } from '../../shared/app-info';
import { getKeyboardShortcuts } from '../../shared/command-registry';
import type { NotebookSettings } from '../../shared/settings';
import Modal from './Modal';

type DialogProps = { onClose: () => void };

const NAVIGATION_SHORTCUTS = [
  { label: 'Move to the next pane', shortcut: 'F6' },
  { label: 'Move to the previous pane', shortcut: 'Shift+F6' },
  { label: 'Move between open tabs', shortcut: 'Left Arrow / Right Arrow, Home, End' },
  { label: 'Close a dialog', shortcut: 'Escape' },
];

export function KeyboardShortcutsDialog({
  onClose,
  shortcuts = {},
  aliasShortcuts = {},
}: DialogProps & {
  shortcuts?: NotebookSettings['shortcuts'];
  aliasShortcuts?: NotebookSettings['shortcutAliases'];
}) {
  const rows = [...NAVIGATION_SHORTCUTS, ...getKeyboardShortcuts(shortcuts, aliasShortcuts)];
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
              <tr key={`${row.label}-${row.shortcut}`}>
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
      <div className="modal-actions">
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      </div>
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
    </Modal>
  );
}

type FeedbackDialogProps = {
  onClose: () => void;
  announce: (message: string) => void;
};

// The same form relay FRAME PDF Studio uses. The access key is a public
// submission key: it only lets a sender submit feedback to this form, so
// it lives in the app source the way it lives in FRAME's published page.
// The user's email address never appears in the app source.
const FEEDBACK_ENDPOINT = 'https://api.web3forms.com/submit';
const FEEDBACK_ACCESS_KEY = 'bbf5c237-6b84-4489-ac9d-7e7caf3037af';

export function FeedbackDialog({ onClose, announce }: FeedbackDialogProps) {
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    // Honeypot: a filled website field means an automated submitter. Say
    // thank you and send nothing, so the filter is never revealed.
    if (website.trim()) {
      setSent(true);
      announce('Thank you. Your feedback was sent.');
      return;
    }
    if (!message.trim()) {
      setError('Enter a message before sending.');
      return;
    }
    setError(null);
    setSending(true);
    announce('Sending feedback…');
    try {
      const trimmedEmail = email.trim();
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: FEEDBACK_ACCESS_KEY,
          // Identify this project in the notification: subject line, sender
          // name, and a body field, so feedback stays distinguishable if
          // the same relay serves other projects.
          subject: 'A11y Notebook feedback',
          from_name: 'A11y Notebook',
          project: 'A11y Notebook',
          message: message.trim(),
          name: name.trim(),
          email: trimmedEmail,
          ...(trimmedEmail ? { replyto: trimmedEmail } : {}),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSent(true);
      announce('Thank you. Your feedback was sent.');
    } catch {
      setError('Feedback could not be sent. Check your connection and try again. Your message is kept here.');
      announce('Feedback could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal titleId="feedback-dialog-title" title="Provide Feedback" describedBy="feedback-dialog-privacy" onClose={onClose}>
      <div className="modal-body">
        {sent ? (
          <>
            <p>Thank you. Your feedback was sent.</p>
            <div className="modal-actions">
              <button type="button" data-autofocus onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p id="feedback-dialog-privacy">
              Only the feedback you type here is sent. No notes, files, or library content are included.
            </p>
            {error ? (
              <p role="alert">{error}</p>
            ) : null}
            <div>
              <label htmlFor="feedback-message">Message (required)</label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={6}
              />
            </div>
            <div>
              <label htmlFor="feedback-name">Name (optional)</label>
              <input
                id="feedback-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="feedback-email">Email (optional)</label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </div>
            <div aria-hidden="true" className="sr-only">
              <label htmlFor="feedback-website">Website</label>
              <input
                id="feedback-website"
                type="text"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>
            <div className="modal-actions">
              <button type="submit" disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        )}
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
