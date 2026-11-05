import { useId, useState } from 'react';
import Modal from '../../components/Modal';
import DatePickerField from '../../components/DatePickerField';
import {
  composeDialogTime,
  isValidDateText,
  splitStoredTime,
} from '../../../shared/reminders';
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
  const id = useId();
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [dueTime, setDueTime] = useState(() => splitStoredTime(task.dueTime ?? '').time);
  const [dueMeridiem, setDueMeridiem] = useState(() => splitStoredTime(task.dueTime ?? '').meridiem);
  const [reminderDate, setReminderDate] = useState(splitReminder(task.remindAt)[0]);
  const [reminderTime, setReminderTime] = useState(() => splitStoredTime(splitReminder(task.remindAt)[1]).time);
  const [reminderMeridiem, setReminderMeridiem] = useState(
    () => splitStoredTime(splitReminder(task.remindAt)[1]).meridiem,
  );
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
          // The AM/PM combobox supplies the meridiem when the typed time
          // has none, exactly as in the Create reminder dialog, so a typed
          // "2:30" plus PM saves as 14:30. A typed AM/PM marker or an
          // unambiguous 24-hour value still wins, per composeDialogTime.
          const normalizedDueTime = dueTime ? composeDialogTime(dueTime, dueMeridiem) : '';
          if (dueTime && !normalizedDueTime) {
            setError('Enter a due time as HH:MM or H:MM AM/PM.');
            return;
          }
          if (reminderDate && !isValidDateText(reminderDate)) {
            setError('Enter a reminder date as YYYY-MM-DD.');
            return;
          }
          const normalizedReminderTime = reminderTime
            ? composeDialogTime(reminderTime, reminderMeridiem)
            : '';
          if (reminderTime && !normalizedReminderTime) {
            setError('Enter a reminder time as HH:MM or H:MM AM/PM.');
            return;
          }
          setBusy(true);
          setError('');
          void onSave({
            dueDate,
            dueTime: normalizedDueTime ?? '',
            remindAt:
              reminderDate && normalizedReminderTime ? `${reminderDate} ${normalizedReminderTime}` : '',
          })
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <p>Set when this task is due, and optionally when to be reminded about it.</p>
        <p>
          Dates and times are plain text fields you can type in directly — opening the date picker is
          optional, never required. Times use your local timezone.
        </p>
        <DatePickerField
          id={`${id}-due-date`}
          label="Due date, YYYY-MM-DD"
          value={dueDate}
          onChange={setDueDate}
          disabled={busy}
        />
        <label htmlFor={`${id}-due-time`}>Due time, HH:MM</label>
        <input
          id={`${id}-due-time`}
          type="text"
          placeholder="HH:MM or 9:30 AM"
          value={dueTime}
          disabled={busy}
          onChange={(event) => setDueTime(event.target.value)}
        />
        <label htmlFor={`${id}-due-meridiem`}>Due AM or PM</label>
        <select
          id={`${id}-due-meridiem`}
          value={dueMeridiem}
          disabled={busy}
          onChange={(event) => setDueMeridiem(event.target.value === 'PM' ? 'PM' : 'AM')}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
        <DatePickerField
          id={`${id}-reminder-date`}
          label="Reminder date, YYYY-MM-DD"
          value={reminderDate}
          onChange={setReminderDate}
          disabled={busy}
        />
        <label htmlFor={`${id}-reminder-time`}>Reminder time, HH:MM</label>
        <input
          id={`${id}-reminder-time`}
          type="text"
          placeholder="HH:MM or 9:30 AM"
          value={reminderTime}
          disabled={busy}
          onChange={(event) => setReminderTime(event.target.value)}
        />
        <label htmlFor={`${id}-reminder-meridiem`}>Reminder AM or PM</label>
        <select
          id={`${id}-reminder-meridiem`}
          value={reminderMeridiem}
          disabled={busy}
          onChange={(event) => setReminderMeridiem(event.target.value === 'PM' ? 'PM' : 'AM')}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
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
