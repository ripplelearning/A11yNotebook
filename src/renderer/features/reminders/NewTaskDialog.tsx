import { useEffect, useId, useState } from 'react';
import Modal from '../../components/Modal';
import DatePickerField from '../../components/DatePickerField';
import { isValidDateText, isValidTimeText, normalizeTimeText } from '../../../shared/reminders';
import { normalizeDateText } from '../../../shared/calendar';

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
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [priority, setPriority] = useState('normal');
  const id = useId();
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
          if ((reminderDate && !reminderTime) || (!reminderDate && reminderTime)) {
            setError('Set both a reminder date and time, or leave both blank.');
            return;
          }
          if (due && !isValidDateText(due)) {
            setError('Enter a due date as MM/DD/YYYY.');
            return;
          }
          if (reminderDate && !isValidDateText(reminderDate)) {
            setError('Enter a reminder date as MM/DD/YYYY.');
            return;
          }
          if (reminderTime && !isValidTimeText(reminderTime)) {
            setError('Enter a reminder time as HH:MM or H:MM AM/PM.');
            return;
          }
          setBusy(true);
          setError('');
          void onCreate({
            text: text.trim(),
            due: normalizeDateText(due) ?? '',
            reminder: reminderDate && reminderTime ? `${normalizeDateText(reminderDate) ?? ''}T${normalizeTimeText(reminderTime) ?? ''}` : '',
            priority,
          })
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Task text
          <input data-autofocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        <DatePickerField
          id={`${id}-due-date`}
          label="Due date, MM/DD/YYYY"
          value={due}
          onChange={setDue}
          disabled={busy}
        />
        <DatePickerField
          id={`${id}-reminder-date`}
          label="Reminder date, MM/DD/YYYY"
          value={reminderDate}
          onChange={setReminderDate}
          disabled={busy}
        />
        <label>
          Reminder time, HH:MM
          <input
            type="text"
            placeholder="HH:MM or 9:30 AM"
            value={reminderTime}
            disabled={busy}
            onChange={(event) => setReminderTime(event.target.value)}
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
  priorityOptions?: string[];
  onClose: () => void;
  onCreate: (path: string, text: string, due: string, priority: string, reminder: string) => Promise<void>;
}

export function AssociatedTaskDialog({
  paths,
  initialPath,
  busy,
  error,
  priorityOptions,
  onClose,
  onCreate,
}: AssociatedTaskProps) {
  const options = priorityOptions?.length ? priorityOptions : ['critical', 'high', 'medium', 'low', 'optional'];
  const [path, setPath] = useState(initialPath && paths.includes(initialPath) ? initialPath : (paths[0] ?? ''));
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [priority, setPriority] = useState(options.includes('medium') ? 'medium' : (options[0] ?? ''));
  const id = useId();
  const [localError, setLocalError] = useState('');
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
          setLocalError('');
          if ((reminderDate && !reminderTime) || (!reminderDate && reminderTime)) {
            setLocalError('Set both a reminder date and time, or leave both blank.');
            return;
          }
          if (due && !isValidDateText(due)) {
            setLocalError('Enter a due date as MM/DD/YYYY.');
            return;
          }
          if (reminderDate && !isValidDateText(reminderDate)) {
            setLocalError('Enter a reminder date as MM/DD/YYYY.');
            return;
          }
          if (reminderTime && !isValidTimeText(reminderTime)) {
            setLocalError('Enter a reminder time as HH:MM or H:MM AM/PM.');
            return;
          }
          if (path && text.trim() && !busy)
            void onCreate(
              path,
              text.trim(),
              normalizeDateText(due) ?? '',
              priority,
              reminderDate && reminderTime ? `${normalizeDateText(reminderDate) ?? ''}T${normalizeTimeText(reminderTime) ?? ''}` : '',
            );
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
        <DatePickerField
          id={`${id}-due-date`}
          label="Due date, MM/DD/YYYY"
          value={due}
          onChange={setDue}
          disabled={busy}
        />
        <DatePickerField
          id={`${id}-reminder-date`}
          label="Reminder date, MM/DD/YYYY"
          value={reminderDate}
          onChange={setReminderDate}
          disabled={busy}
        />
        <label>
          Reminder time, HH:MM
          <input
            type="text"
            placeholder="HH:MM or 9:30 AM"
            value={reminderTime}
            disabled={busy}
            onChange={(event) => setReminderTime(event.target.value)}
          />
        </label>
        <label>
          Priority
          <select value={priority} disabled={busy} onChange={(event) => setPriority(event.target.value)}>
            {options.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        {localError || error ? <p role="alert">{localError || error}</p> : null}
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
