import { useState } from 'react';
import type { Reminder, SnoozeDuration } from '../../../shared/reminders';
import Modal from '../../components/Modal';

interface Props {
  reminder: Reminder;
  count: number;
  locked?: boolean;
  onComplete: () => Promise<void>;
  onDismiss: () => Promise<void>;
  onSnooze: (duration: SnoozeDuration) => Promise<void>;
  onLater: () => void;
  restoreFocusTo?: HTMLElement | null;
}

export default function ReminderAlertDialog({
  reminder,
  count,
  locked,
  onComplete,
  onDismiss,
  onSnooze,
  onLater,
  restoreFocusTo,
}: Props) {
  const [duration, setDuration] = useState<SnoozeDuration>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    void operation()
      .catch(() => setError('Could not update reminder. Save or resolve note changes, then retry.'))
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      role="alertdialog"
      title="Reminder"
      titleId="reminder-alert-title"
      describedBy="reminder-alert-description"
      restoreFocusTo={restoreFocusTo}
      onClose={() => {
        if (!busy) onLater();
      }}
    >
      <div id="reminder-alert-description">
        <p>{locked || reminder.privacy === 'hide-title' ? 'A reminder is due.' : reminder.title}</p>
        {locked ? <p>Unlock the vault to view it.</p> : null}
        <p role="status">
          {count} reminder{count === 1 ? '' : 's'} waiting.
        </p>
        <p>Escape or Later closes this alert without dismissing the reminder. It remains in Reminders.</p>
      </div>
      <button data-autofocus type="button" disabled={busy || locked} onClick={() => run(onComplete)}>
        Mark Complete
      </button>
      <button type="button" disabled={busy || locked} onClick={() => run(onDismiss)}>
        Dismiss
      </button>
      <label>
        Snooze duration
        <select
          value={duration}
          disabled={busy || locked}
          onChange={(event) =>
            setDuration(event.target.value === 'tomorrow' ? 'tomorrow' : (Number(event.target.value) as SnoozeDuration))
          }
        >
          <option value={5}>5 minutes</option>
          <option value={15}>15 minutes</option>
          <option value={30}>30 minutes</option>
          <option value={60}>1 hour</option>
          <option value={1440}>1 day (24 hours)</option>
          <option value="tomorrow">Tomorrow</option>
        </select>
      </label>
      <button type="button" disabled={busy || locked} onClick={() => run(() => onSnooze(duration))}>
        Snooze
      </button>
      <button type="button" disabled={busy} onClick={onLater}>
        Later
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
  );
}
