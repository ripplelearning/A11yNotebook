import { useEffect, useId, useRef, useState } from 'react';
import {
  shiftDateText,
  combineDateTime,
  parseAppointmentTime,
  parseDateOnly,
  type AppointmentInput,
  type CalendarAppointment,
  type CalendarLink,
  type CalendarRecurrence,
} from '../../../shared/calendar';
import type { VaultTask } from '../../../shared/types';
import { normalizeTimeText } from '../../../shared/reminders';
import Modal from '../../components/Modal';
import DatePickerField from '../../components/DatePickerField';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function splitDateTime(value: string): { date: string; time: string } {
  const parts = parseAppointmentTime(value);
  if (!parts) return { date: '', time: '' };
  const pad = (item: number) => String(item).padStart(2, '0');
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date, time: '' };
  return { date, time: `${pad(parts.hour)}:${pad(parts.minute)}` };
}

function taskOptionValue(task: VaultTask): string {
  return `${task.path}\0${task.taskId ?? task.id}`;
}

export default function AppointmentDialog({
  appointment,
  notePaths,
  filePaths,
  tasks,
  onSave,
  onDelete,
  onClose,
}: {
  appointment?: CalendarAppointment;
  notePaths: string[];
  filePaths: string[];
  tasks: VaultTask[];
  onSave: (input: AppointmentInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const startParts = appointment ? splitDateTime(appointment.start) : { date: '', time: '' };
  const endParts = appointment?.end ? splitDateTime(appointment.end) : { date: '', time: '' };
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [allDay, setAllDay] = useState(appointment?.allDay ?? false);
  const [startDate, setStartDate] = useState(startParts.date);
  const [startTime, setStartTime] = useState(startParts.time);
  const [endDate, setEndDate] = useState(
    appointment?.allDay && appointment.end ? (shiftDateText(appointment.end, -1) ?? '') : endParts.date,
  );
  const [endTime, setEndTime] = useState(endParts.time);
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [description, setDescription] = useState(appointment?.description ?? '');
  const [frequency, setFrequency] = useState<CalendarRecurrence['frequency'] | 'none'>(
    appointment?.recurrence?.frequency ?? 'none',
  );
  const [interval, setInterval] = useState(appointment?.recurrence?.interval ?? 1);
  const [count, setCount] = useState(
    appointment?.recurrence?.count === undefined ? '' : String(appointment.recurrence.count),
  );
  const [until, setUntil] = useState(appointment?.recurrence?.until ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(appointment?.recurrence?.weekdays ?? []);
  const [linkKind, setLinkKind] = useState<CalendarLink['kind'] | 'none'>(appointment?.link?.kind ?? 'none');
  const [linkTarget, setLinkTarget] = useState(
    appointment?.link?.kind === 'task'
      ? `${appointment.link.path}\0${appointment.link.taskId}`
      : (appointment?.link?.path ?? ''),
  );
  const [reminder, setReminder] = useState(
    appointment?.reminderMinutesBefore === undefined ? '' : String(appointment.reminderMinutesBefore),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function close() {
    if (saving.current) return;
    mounted.current = false;
    onClose();
  }

  function buildInput(): AppointmentInput | string {
    if (!title.trim()) return 'Enter an appointment title.';
    if (title.trim().length > 500) return 'Keep the title to 500 characters or fewer.';
    if (!parseDateOnly(startDate)) return 'Enter a valid start date.';
    const startTimeNormalized = allDay ? null : normalizeTimeText(startTime);
    const start = allDay ? startDate : startTimeNormalized ? combineDateTime(startDate, startTimeNormalized) : null;
    if (!start) return allDay ? 'Enter a valid start date.' : 'Enter a valid start date and time.';
    let end: string | undefined;
    if (endDate) {
      if (!parseDateOnly(endDate)) return 'Enter a valid end date.';
      if (allDay) {
        end = shiftDateText(endDate, 1) ?? undefined;
        if (!end) return 'Enter a valid end date.';
      } else {
        if (!endTime) return 'Enter an end time when an end date is set.';
        const endTimeNormalized = normalizeTimeText(endTime);
        end = endTimeNormalized ? (combineDateTime(endDate, endTimeNormalized) ?? undefined) : undefined;
        if (!end) return 'Enter a valid end date and time.';
      }
      const startPartsValue = parseAppointmentTime(start);
      const endPartsValue = parseAppointmentTime(end);
      if (startPartsValue && endPartsValue) {
        const keys = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;
        for (const key of keys) {
          if (startPartsValue[key] !== endPartsValue[key]) {
            if (startPartsValue[key] > endPartsValue[key]) return 'The end must not be before the start.';
            break;
          }
        }
      }
    }
    let recurrence: CalendarRecurrence | undefined;
    if (frequency !== 'none') {
      if (!Number.isInteger(interval) || interval < 1) return 'The recurrence interval must be 1 or more.';
      const parsedCount = count.trim() === '' ? undefined : Number(count);
      if (parsedCount !== undefined && (!Number.isInteger(parsedCount) || parsedCount < 1))
        return 'The recurrence count must be 1 or more.';
      if (until && !parseDateOnly(until)) return 'Enter a valid recurrence end date.';
      recurrence = {
        frequency,
        interval,
        ...(parsedCount !== undefined ? { count: parsedCount } : {}),
        ...(until ? { until } : {}),
        ...(frequency === 'weekly' && weekdays.length
          ? { weekdays: [...weekdays].sort((a, b) => a - b) }
          : {}),
      };
    }
    let link: CalendarLink | undefined;
    if (linkKind === 'note' || linkKind === 'file') {
      if (!linkTarget) return 'Choose a note or file to link.';
      link = { kind: linkKind, path: linkTarget };
    } else if (linkKind === 'task') {
      const [path, taskId] = linkTarget.split('\0');
      if (!path || !taskId) return 'Choose a task to link.';
      link = { kind: 'task', path, taskId };
    }
    if (allDay && reminder !== '') return 'Reminders are available for timed appointments only.';
    return {
      title: title.trim(),
      start,
      ...(end ? { end } : {}),
      allDay,
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(link ? { link } : {}),
      ...(reminder !== '' ? { reminderMinutesBefore: Number(reminder) } : {}),
      ...(recurrence ? { recurrence } : {}),
    };
  }

  async function save() {
    if (saving.current) return;
    const input = buildInput();
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(input);
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save appointment.');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function remove() {
    if (!appointment || !onDelete || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onDelete(appointment.id);
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not delete appointment.');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const linkTargets =
    linkKind === 'note' ? notePaths : linkKind === 'file' ? filePaths : linkKind === 'task' ? tasks : [];
  return (
    <Modal
      titleId={`${id}-dialog-title`}
      title={appointment ? 'Edit appointment' : 'New appointment'}
      onClose={close}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <legend>Appointment details</legend>
          {appointment?.recurrence && (
            <p>Editing changes the whole series, not just one occurrence.</p>
          )}
          <label htmlFor={`${id}-title`}>Title</label>
          <input
            id={`${id}-title`}
            data-autofocus={!busy || undefined}
            disabled={busy}
            value={title}
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />
            All-day appointment
          </label>
          <DatePickerField
            id={`${id}-start-date`}
            label="Start date"
            value={startDate}
            onChange={setStartDate}
            disabled={busy}
            required
          />
          {!allDay && (
            <>
              <label htmlFor={`${id}-start-time`}>Start time</label>
              <input
                id={`${id}-start-time`}
                type="text"
                placeholder="HH:MM or 9:30 AM"
                disabled={busy}
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                required
              />
            </>
          )}
          <DatePickerField
            id={`${id}-end-date`}
            label="End date (optional)"
            value={endDate}
            onChange={setEndDate}
            disabled={busy}
          />
          {!allDay && endDate && (
            <>
              <label htmlFor={`${id}-end-time`}>End time</label>
              <input
                id={`${id}-end-time`}
                type="text"
                placeholder="HH:MM or 9:30 AM"
                disabled={busy}
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                required
              />
            </>
          )}
          <label htmlFor={`${id}-location`}>Location (optional)</label>
          <input
            id={`${id}-location`}
            disabled={busy}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
          <label htmlFor={`${id}-description`}>Description (optional)</label>
          <textarea
            id={`${id}-description`}
            disabled={busy}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Recurrence</legend>
          <label htmlFor={`${id}-frequency`}>Repeats</label>
          <select
            id={`${id}-frequency`}
            value={frequency}
            disabled={busy}
            onChange={(event) => setFrequency(event.target.value as typeof frequency)}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          {frequency !== 'none' && (
            <>
              <label htmlFor={`${id}-interval`}>Every</label>
              <input
                id={`${id}-interval`}
                type="number"
                min={1}
                disabled={busy}
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
              <span>{frequency === 'daily' ? 'days' : frequency === 'weekly' ? 'weeks' : frequency === 'monthly' ? 'months' : 'years'}</span>
              {frequency === 'weekly' && (
                <fieldset>
                  <legend>On these weekdays (leave all clear to repeat on the start weekday)</legend>
                  {WEEKDAYS.map((day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={weekdays.includes(index)}
                        onChange={(event) =>
                          setWeekdays((current) =>
                            event.target.checked
                              ? [...current, index]
                              : current.filter((item) => item !== index),
                          )
                        }
                      />
                      {day}
                    </label>
                  ))}
                </fieldset>
              )}
              <label htmlFor={`${id}-count`}>Number of occurrences (optional)</label>
              <input
                id={`${id}-count`}
                type="number"
                min={1}
                disabled={busy}
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
              <DatePickerField
                id={`${id}-until`}
                label="Repeat until (optional)"
                value={until}
                onChange={setUntil}
                disabled={busy}
              />
            </>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Link (optional)</legend>
          <label htmlFor={`${id}-link-kind`}>Link to</label>
          <select
            id={`${id}-link-kind`}
            value={linkKind}
            disabled={busy}
            onChange={(event) => {
              setLinkKind(event.target.value as typeof linkKind);
              setLinkTarget('');
            }}
          >
            <option value="none">Nothing</option>
            <option value="note">Note</option>
            <option value="file">File</option>
            <option value="task">Task</option>
          </select>
          {linkKind !== 'none' && (
            <>
              <label htmlFor={`${id}-link-target`}>
                {linkKind === 'note' ? 'Note' : linkKind === 'file' ? 'File' : 'Task'}
              </label>
              <select
                id={`${id}-link-target`}
                value={linkTarget}
                disabled={busy}
                onChange={(event) => setLinkTarget(event.target.value)}
              >
                <option value="">Choose…</option>
                {linkKind === 'task'
                  ? (linkTargets as VaultTask[]).map((task) => (
                      <option key={taskOptionValue(task)} value={taskOptionValue(task)}>
                        {task.text} — {task.path}
                      </option>
                    ))
                  : (linkTargets as string[]).map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
              </select>
            </>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Reminder (optional)</legend>
          <label htmlFor={`${id}-reminder`}>Remind me</label>
          <select
            id={`${id}-reminder`}
            value={reminder}
            disabled={busy || allDay}
            onChange={(event) => setReminder(event.target.value)}
          >
            <option value="">No reminder</option>
            <option value="0">At start</option>
            <option value="5">5 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="1440">1 day before</option>
          </select>
          {allDay && <p>Reminders are available for timed appointments.</p>}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Saving appointment. Please wait.</p>}
        <div className="modal-actions">
          <button type="submit" disabled={busy}>
            Save appointment
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          {appointment && onDelete && !confirmDelete && (
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete appointment
            </button>
          )}
          {appointment && onDelete && confirmDelete && (
            <>
              <p>Deleting removes the whole series, not just one occurrence.</p>
              <button type="button" disabled={busy} onClick={() => void remove()}>
                Delete the whole series
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
                Keep appointment
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
