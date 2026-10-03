import { useId, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { parseReminderDate, type CreateReminderInput } from '../../../shared/reminders';

export interface CreateReminderDialogProps {
  notePaths: string[];
  onCreate: (input: CreateReminderInput) => void | Promise<unknown>;
  onClose: () => void;
}

export default function CreateReminderDialog({ notePaths, onCreate, onClose }: CreateReminderDialogProps) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [path, setPath] = useState(notePaths[0] ?? '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const scheduledAt = `${date} ${time}`;
    if (!title.trim() || !notePaths.includes(path) || !parseReminderDate(scheduledAt)) {
      setError('Enter a title, note, and valid date and time.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onCreate({ title: title.trim(), path, scheduledAt });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create reminder.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal titleId={`${id}-title`} title="Create reminder" onClose={onClose}>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label htmlFor={`${id}-name`}>Reminder title</label>
        <input
          id={`${id}-name`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={500}
          required
          data-autofocus
        />
        <label htmlFor={`${id}-note`}>Note</label>
        <select id={`${id}-note`} value={path} onChange={(event) => setPath(event.target.value)} required>
          {notePaths.map((note) => (
            <option key={note} value={note}>
              {note}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-date`}>Date</label>
        <input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        <label htmlFor={`${id}-time`}>Time</label>
        <input id={`${id}-time`} type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
        <p>Times use your local timezone.</p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || notePaths.length === 0}>
          {busy ? 'Creating…' : 'Create reminder'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
