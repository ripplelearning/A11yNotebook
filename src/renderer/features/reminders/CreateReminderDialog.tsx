import { useEffect, useId, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { parseReminderDate, type CreateReminderInput, type SnoozeDuration } from '../../../shared/reminders';
import { DEFAULT_REMINDER_DEFAULTS, type ReminderDefaults } from '../../../shared/reminder-defaults';

export interface CreateReminderDialogProps {
  notePaths: string[];
  onCreate: (input: CreateReminderInput) => void | Promise<unknown>;
  defaults?: ReminderDefaults;
  onSaveDefaults?: (defaults: ReminderDefaults) => void | Promise<unknown>;
  onClose: () => void;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function CreateReminderDialog({
  notePaths,
  onCreate,
  defaults = DEFAULT_REMINDER_DEFAULTS,
  onSaveDefaults,
  onClose,
}: CreateReminderDialogProps) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [path, setPath] = useState(notePaths[0] ?? '');
  const [date, setDate] = useState(localDate);
  const [time, setTime] = useState(defaults.time);
  const [snooze, setSnooze] = useState(defaults.snooze);
  const [privacy, setPrivacy] = useState(defaults.privacy);
  const [notifications, setNotifications] = useState(defaults.notification.reminders);
  const [flashcardNotifications, setFlashcardNotifications] = useState(defaults.notification.flashcards);
  const [saveAsDefaults, setSaveAsDefaults] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTime(defaults.time);
    setSnooze(defaults.snooze);
    setPrivacy(defaults.privacy);
    setNotifications(defaults.notification.reminders);
    setFlashcardNotifications(defaults.notification.flashcards);
  }, [defaults]);
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
      const nextDefaults: ReminderDefaults = {
        version: 1,
        time,
        snooze,
        privacy,
        notification: { reminders: notifications, flashcards: flashcardNotifications },
      };
      if (saveAsDefaults && onSaveDefaults) await onSaveDefaults(nextDefaults);
      await onCreate({
        title: title.trim(),
        path,
        scheduledAt,
        privacy,
        notification: notifications,
      });
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
        <label htmlFor={`${id}-snooze`}>Default snooze duration</label>
        <select
          id={`${id}-snooze`}
          value={snooze}
          onChange={(event) =>
            setSnooze(event.target.value === 'tomorrow' ? 'tomorrow' : (Number(event.target.value) as SnoozeDuration))
          }
        >
          <option value="5">5 minutes</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="1440">1 day (24 hours)</option>
          <option value="60">60 minutes</option>
          <option value="tomorrow">Tomorrow</option>
        </select>
        <label htmlFor={`${id}-privacy`}>Notification privacy</label>
        <select
          id={`${id}-privacy`}
          value={privacy}
          onChange={(event) => setPrivacy(event.target.value as typeof privacy)}
        >
          <option value="show-title">Show reminder title</option>
          <option value="hide-title">Hide reminder title</option>
        </select>
        <label>
          <input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} />
          Show reminder notifications
        </label>
        <label>
          <input
            type="checkbox"
            checked={flashcardNotifications}
            onChange={(event) => setFlashcardNotifications(event.target.checked)}
          />
          Allow due flashcard notifications
        </label>
        {onSaveDefaults && (
          <label>
            <input
              type="checkbox"
              checked={saveAsDefaults}
              onChange={(event) => setSaveAsDefaults(event.target.checked)}
            />
            Use these choices as future defaults
          </label>
        )}
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
