import { useState } from 'react';
import Modal from '../../components/Modal';
import { isValidDateText, isValidTimeText, normalizeTimeText } from '../../../shared/reminders';
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

function splitReminder(value: string | undefined): [string, string] {
  if (!value) return ['', ''];
  const [date, time] = value.split(' ');
  return [date ?? '', time ?? ''];
}

export default function TaskScheduleDialog({ task, onSave, onClose }: Props) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task.dueTime ?? '');
  const [reminderDate, setReminderDate] = useState(splitReminder(task.remindAt)[0]);
  const [reminderTime, setReminderTime] = useState(splitReminder(task.remindAt)[1]);
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
          if ((reminderDate && !reminderTime) || (!reminderDate && reminderTime)) {
            setError('Set both a reminder date and time, or leave both blank.');
            return;
          }
          if (dueDate && !isValidDateText(dueDate)) {
            setError('Enter a due date as YYYY-MM-DD.');
            return;
          }
          if (dueTime && !isValidTimeText(dueTime)) {
            setError('Enter a due time as HH:MM or H:MM AM/PM.');
            return;
          }
          if (reminderDate && !isValidDateText(reminderDate)) {
            setError('Enter a reminder date as YYYY-MM-DD.');
            return;
          }
          if (reminderTime && !isValidTimeText(reminderTime)) {
            setError('Enter a reminder time as HH:MM or H:MM AM/PM.');
            return;
          }
          setBusy(true);
          setError('');
          const normalizedDueTime = dueTime ? (normalizeTimeText(dueTime) ?? '') : '';
          const normalizedReminderTime = reminderTime ? (normalizeTimeText(reminderTime) ?? '') : '';
          void onSave({
            dueDate,
            dueTime: normalizedDueTime,
            remindAt: reminderDate && normalizedReminderTime ? `${reminderDate} ${normalizedReminderTime}` : '',
          })
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <p>Set when this task is due, and optionally when to be reminded about it.</p>
        <label>
          Due date, YYYY-MM-DD
          <input
            data-autofocus
            type="text"
            placeholder="YYYY-MM-DD"
            value={dueDate}
            disabled={busy}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
        <label>
          Due time, HH:MM
          <input type="text" placeholder="HH:MM or 9:30 AM" value={dueTime} disabled={busy} onChange={(event) => setDueTime(event.target.value)} />
        </label>
        <label>
          Reminder date, YYYY-MM-DD
          <input
            type="text"
            placeholder="YYYY-MM-DD"
            value={reminderDate}
            disabled={busy}
            onChange={(event) => setReminderDate(event.target.value)}
          />
        </label>
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
