import { useEffect, useId, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import DatePickerField from '../../components/DatePickerField';
import {
  composeDialogTime,
  parseReminderDate,
  splitStoredTime,
  type CreateReminderInput,
  type SnoozeDuration,
} from '../../../shared/reminders';
import { DEFAULT_REMINDER_DEFAULTS, type ReminderDefaults } from '../../../shared/reminder-defaults';
import { normalizeDateText } from '../../../shared/calendar';

export interface CreateReminderDialogProps {
  notePaths: string[];
  /** Files the reminder may link to, alongside notes. */
  filePaths?: string[];
  /** Saved web links the reminder may link to, alongside notes and files. */
  linkPaths?: string[];
  /** Path to pre-select, for example the note, file, or link a context menu was opened on. */
  initialPath?: string;
  onCreate: (input: CreateReminderInput) => void | Promise<unknown>;
  defaults?: ReminderDefaults;
  onSaveDefaults?: (defaults: ReminderDefaults) => void | Promise<unknown>;
  onClose: () => void;
}

export type ReminderLinkKind = 'note' | 'file' | 'link';

function localDate() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
}

export default function CreateReminderDialog({
  notePaths,
  filePaths = [],
  linkPaths = [],
  initialPath,
  onCreate,
  defaults = DEFAULT_REMINDER_DEFAULTS,
  onSaveDefaults,
  onClose,
}: CreateReminderDialogProps) {
  const id = useId();
  const [title, setTitle] = useState('');
  // The linked item is a note, a file, or a saved web link, mirroring
  // the appointment link picker. When more than one kind is available
  // the kind is chosen first; when only one kind exists the kind is
  // forced and the picker is hidden.
  const targetsFor = (kind: ReminderLinkKind) =>
    kind === 'note' ? notePaths : kind === 'file' ? filePaths : linkPaths;
  const initialKind: ReminderLinkKind =
    initialPath && linkPaths.includes(initialPath)
      ? 'link'
      : initialPath && filePaths.includes(initialPath)
        ? 'file'
        : initialPath && notePaths.includes(initialPath)
          ? 'note'
          : notePaths.length > 0
            ? 'note'
            : filePaths.length > 0
              ? 'file'
              : 'link';
  const initialTargets = targetsFor(initialKind);
  const [linkKind, setLinkKind] = useState<ReminderLinkKind>(initialKind);
  const [path, setPath] = useState(
    initialPath && initialTargets.includes(initialPath) ? initialPath : (initialTargets[0] ?? ''),
  );
  const linkTargets = targetsFor(linkKind);
  const [date, setDate] = useState(localDate);
  const [time, setTime] = useState(() => splitStoredTime(defaults.time).time);
  const [meridiem, setMeridiem] = useState(() => splitStoredTime(defaults.time).meridiem);
  const [snooze, setSnooze] = useState(defaults.snooze);
  const [privacy, setPrivacy] = useState(defaults.privacy);
  const [notifications, setNotifications] = useState(defaults.notification.reminders);
  const [flashcardNotifications, setFlashcardNotifications] = useState(defaults.notification.flashcards);
  const [saveAsDefaults, setSaveAsDefaults] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const split = splitStoredTime(defaults.time);
    setTime(split.time);
    setMeridiem(split.meridiem);
    setSnooze(defaults.snooze);
    setPrivacy(defaults.privacy);
    setNotifications(defaults.notification.reminders);
    setFlashcardNotifications(defaults.notification.flashcards);
  }, [defaults]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const normalizedTime = composeDialogTime(time, meridiem);
    if (!normalizedTime) {
      setError('Enter a title, a note, file, or link, and a valid date and time.');
      return;
    }
    // The date the user typed is MM/DD/YYYY; store it as YYYY-MM-DD.
    const isoDate = normalizeDateText(date);
    const scheduledAt = isoDate ? `${isoDate} ${normalizedTime}` : '';
    if (!title.trim() || !linkTargets.includes(path) || !parseReminderDate(scheduledAt)) {
      setError('Enter a title, a note, file, or link, and a valid date and time.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextDefaults: ReminderDefaults = {
        version: 1,
        time: normalizedTime,
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
        {[notePaths, filePaths, linkPaths].filter((targets) => targets.length > 0).length > 1 && (
          <>
            <label htmlFor={`${id}-link-kind`}>Link to</label>
            <select
              id={`${id}-link-kind`}
              value={linkKind}
              onChange={(event) => {
                const next = event.target.value as ReminderLinkKind;
                setLinkKind(next);
                setPath(targetsFor(next)[0] ?? '');
              }}
            >
              {notePaths.length > 0 && <option value="note">Note</option>}
              {filePaths.length > 0 && <option value="file">File</option>}
              {linkPaths.length > 0 && <option value="link">Link</option>}
            </select>
          </>
        )}
        <label htmlFor={`${id}-note`}>{linkKind === 'note' ? 'Note' : linkKind === 'file' ? 'File' : 'Link'}</label>
        <select id={`${id}-note`} value={path} onChange={(event) => setPath(event.target.value)} required>
          {linkTargets.map((target) => (
            <option key={target} value={target}>
              {target}
            </option>
          ))}
        </select>
        <DatePickerField id={`${id}-date`} label="Date, MM/DD/YYYY" value={date} onChange={setDate} required />
        <label htmlFor={`${id}-time`}>Time, HH:MM</label>
        <input
          id={`${id}-time`}
          type="text"
          placeholder="HH:MM or 9:30 AM"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          required
        />
        <label htmlFor={`${id}-meridiem`}>AM or PM</label>
        <select
          id={`${id}-meridiem`}
          value={meridiem}
          onChange={(event) => setMeridiem(event.target.value === 'PM' ? 'PM' : 'AM')}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
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
        <p>
          Times use your local timezone. The AM or PM choice applies unless the time you type already includes AM or
          PM or is 24-hour (14:30).
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || linkTargets.length === 0}>
          {busy ? 'Creating…' : 'Create reminder'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
