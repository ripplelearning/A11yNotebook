import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';

export interface NewTaskFields {
  text: string;
  due: string;
  reminder: string;
  priority: string;
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

interface Props {
  onCreate: (fields: NewTaskFields) => Promise<void>;
  onClose: () => void;
}

export default function NewTaskDialog({ onCreate, onClose }: Props) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [reminder, setReminder] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="New task" titleId="new-task-title" onClose={close}>
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
          void onCreate({ text: text.trim(), due, reminder, priority })
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Task text
          <input data-autofocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        <label>
          Due date
          <input type="date" value={due} disabled={busy} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label>
          Reminder time
          <input
            type="datetime-local"
            value={reminder}
            disabled={busy}
            onChange={(event) => setReminder(event.target.value)}
          />
        </label>
        <label>
          Priority
          <select value={priority} disabled={busy} onChange={(event) => setPriority(event.target.value)}>
            {PRIORITIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          Create task
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}

interface AssociatedTaskProps {
  paths: string[];
  initialPath?: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: (path: string, text: string, due: string, priority: string, reminder: string) => Promise<void>;
}

export function AssociatedTaskDialog({ paths, initialPath, busy, error, onClose, onCreate }: AssociatedTaskProps) {
  const [path, setPath] = useState(initialPath && paths.includes(initialPath) ? initialPath : (paths[0] ?? ''));
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [reminder, setReminder] = useState('');
  const [priority, setPriority] = useState('normal');
  useEffect(() => {
    setPath((current) =>
      paths.includes(current) ? current : initialPath && paths.includes(initialPath) ? initialPath : (paths[0] ?? ''),
    );
  }, [paths, initialPath]);
  return (
    <Modal
      title="New task"
      titleId="new-task-heading"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (path && text.trim() && !busy) void onCreate(path, text.trim(), due, priority, reminder);
        }}
      >
        <p>Tasks are saved as checkboxes in their associated note.</p>
        <p>Only managed, unencrypted notes are available. Cognitive tool files are excluded.</p>
        {!paths.length ? (
          <p>{busy ? 'Checking eligible notes…' : 'Create an unencrypted managed note before adding a task.'}</p>
        ) : null}
        <label>
          Associated note
          <select required value={path} disabled={busy} onChange={(event) => setPath(event.target.value)}>
            {!paths.length ? <option value="">No notes available</option> : null}
            {paths.map((relative) => (
              <option key={relative}>{relative}</option>
            ))}
          </select>
        </label>
        <label>
          Task description
          <input
            data-autofocus
            required
            maxLength={500}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label>
          Due date
          <input type="date" value={due} disabled={busy} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label>
          Reminder time
          <input
            type="datetime-local"
            value={reminder}
            disabled={busy}
            onChange={(event) => setReminder(event.target.value)}
          />
        </label>
        <label>
          Priority
          <select value={priority} disabled={busy} onChange={(event) => setPriority(event.target.value)}>
            {PRIORITIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !path || !text.trim()}>
          Create task
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
