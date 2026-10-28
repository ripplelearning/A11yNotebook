import { useEffect, useId, useState } from 'react';
import {
  groupReminders,
  type CreateReminderInput,
  type Reminder,
  type SnoozeDuration,
} from '../../../shared/reminders';
import CreateReminderDialog from './CreateReminderDialog';
import { DEFAULT_REMINDER_DEFAULTS, type ReminderDefaults } from '../../../shared/reminder-defaults';

export interface RemindersViewProps {
  title?: string;
  reminders: Reminder[];
  notePaths: string[];
  /** Increment to open the Create reminder dialog (for example, from Ctrl+N). */
  createRequest?: number;
  onCreate: (input: CreateReminderInput) => void | Promise<unknown>;
  onDismiss: (id: string) => void | Promise<unknown>;
  onSnooze: (id: string, duration: SnoozeDuration) => void | Promise<unknown>;
  onOpenNote: (path: string, line?: number) => void | Promise<unknown>;
  onOpenCalendar?: () => void | Promise<unknown>;
  defaults?: ReminderDefaults;
  onSaveDefaults?: (defaults: ReminderDefaults) => void | Promise<unknown>;
  now?: Date;
}

export default function RemindersView({
  title: headingTitle = 'Reminders',
  reminders,
  notePaths,
  createRequest = 0,
  onCreate,
  onDismiss,
  onSnooze,
  onOpenNote,
  onOpenCalendar,
  defaults = DEFAULT_REMINDER_DEFAULTS,
  onSaveDefaults,
  now = new Date(),
}: RemindersViewProps) {
  const id = useId();
  const [view, setView] = useState('agenda');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (createRequest > 0) setCreating(true);
  }, [createRequest]);
  const visible = reminders
    .filter((item) => item.status !== 'dismissed' && item.status !== 'completed')
    .slice()
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const groups = groupReminders(visible, now);
  async function run(action: () => void | Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update reminder.');
    } finally {
      setBusy(false);
    }
  }
  const title = (item: Reminder) => {
    if (item.source === 'appointment') {
      if (!onOpenCalendar) return <span>{item.title}</span>;
      return (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(() => onOpenCalendar());
          }}
        >
          {item.title}
        </button>
      );
    }
    if (item.path === undefined) return <span>{item.title}</span>;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void run(() => onOpenNote(item.path!, item.line));
        }}
      >
        {item.title}
      </button>
    );
  };
  const time = (item: Reminder) => (
    <time dateTime={item.scheduledAt}>{new Date(item.scheduledAt).toLocaleString()}</time>
  );
  const actions = (item: Reminder) => (
    <>
      <select
        aria-label={`Snooze ${item.title}`}
        value=""
        disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) return;
          const duration: SnoozeDuration = value === 'tomorrow' ? 'tomorrow' : (Number(value) as SnoozeDuration);
          void run(() => onSnooze(item.id, duration));
        }}
      >
        <option value="">Snooze…</option>
        <option value="5">5 minutes{defaults.snooze === 5 ? ' (default)' : ''}</option>
        <option value="15">15 minutes{defaults.snooze === 15 ? ' (default)' : ''}</option>
        <option value="30">30 minutes{defaults.snooze === 30 ? ' (default)' : ''}</option>
        <option value="1440">1 day (24 hours){defaults.snooze === 1440 ? ' (default)' : ''}</option>
        <option value="60">60 minutes{defaults.snooze === 60 ? ' (default)' : ''}</option>
        <option value="tomorrow">Tomorrow{defaults.snooze === 'tomorrow' ? ' (default)' : ''}</option>
      </select>
      <button
        type="button"
        disabled={busy}
        aria-label={`Dismiss ${item.title}`}
        onClick={() => {
          void run(() => onDismiss(item.id));
        }}
      >
        Dismiss
      </button>
    </>
  );
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{headingTitle}</h2>
      <button type="button" disabled={notePaths.length === 0} onClick={() => setCreating(true)}>
        Create reminder
      </button>
      {notePaths.length === 0 ? <p>Create reminder needs at least one note in the library.</p> : null}
      <label htmlFor={`${id}-view`}>Reminder view</label>
      <select id={`${id}-view`} value={view} onChange={(event) => setView(event.target.value)}>
        <option value="agenda">Grouped agenda</option>
        <option value="table">All reminders table</option>
      </select>
      {error && <p role="alert">{error}</p>}
      {visible.length === 0 && <p>No reminders.</p>}
      {view === 'table' ? (
        <table>
          <caption>All active reminders</caption>
          <thead>
            <tr>
              <th scope="col">Reminder</th>
              <th scope="col">Note</th>
              <th scope="col">Time</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id} data-context="reminder" data-path={item.path} data-reminder-id={item.id} tabIndex={-1}>
                <th scope="row">{title(item)}</th>
                <td>{item.path ?? 'Calendar'}</td>
                <td>{time(item)}</td>
                <td>{item.status}</td>
                <td>{actions(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          {(
            [
              ['Overdue', groups.overdue],
              ['Today', groups.today],
              ['This week', groups.thisWeek],
            ] as const
          ).map(([heading, items]) => (
            <section key={heading} aria-label={heading}>
              <h3>{heading}</h3>
              {items.length ? (
                <ul>
                  {items.map((item) => (
                    <li
                      key={item.id}
                      data-context="reminder"
                      data-path={item.path}
                      data-reminder-id={item.id}
                      tabIndex={-1}
                    >
                      {title(item)} — {item.path ?? 'Calendar'} — {time(item)} {actions(item)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No reminders {heading.toLowerCase()}.</p>
              )}
            </section>
          ))}
          <p>Use the all reminders table to see reminders scheduled beyond this week.</p>
        </>
      )}
      {creating && (
        <CreateReminderDialog
          notePaths={notePaths}
          defaults={defaults}
          onSaveDefaults={onSaveDefaults}
          onCreate={onCreate}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}
