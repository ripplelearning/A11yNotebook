import { useState } from 'react';
import Modal from '../../components/Modal';
import type { VaultTask } from '../../../shared/types';

export interface TaskSchedule {
  dueDate: string;
  dueTime: string;
  /** Reminder in "YYYY-MM-DD HH:mm" form, or '' for none. */
  remindAt: string;
}

interface Props {
  task: VaultTask;
  onSave: (schedule: TaskSchedule) => Promise<void>;
  onClose: () => void;
}

function toDatetimeLocal(value: string): string {
  return value.replace(' ', 'T');
}

export default function TaskScheduleDialog({ task, onSave, onClose }: Props) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task.dueTime ?? '');
  const [reminder, setReminder] = useState(task.remindAt ? toDatetimeLocal(task.remindAt) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="Set due date" titleId="task-schedule-title" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (dueTime && !dueDate) {
            setError('Set a due date to use a due time.');
            return;
          }
          setBusy(true);
          setError('');
          void onSave({ dueDate, dueTime, remindAt: reminder.replace('T', ' ') })
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <p>Set when this task is due, and optionally when to be reminded about it.</p>
        <label>
          Due date
          <input
            data-autofocus
            type="date"
            value={dueDate}
            disabled={busy}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
        <label>
          Due time
          <input type="time" value={dueTime} disabled={busy} onChange={(event) => setDueTime(event.target.value)} />
        </label>
        <label>
          Reminder (optional)
          <input
            type="datetime-local"
            value={reminder}
            disabled={busy}
            onChange={(event) => setReminder(event.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          Save due date
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
