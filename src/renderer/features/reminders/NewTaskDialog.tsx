import { useEffect, useId, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import DatePickerField from '../../components/DatePickerField';
import { isValidDateText, isValidTimeText, normalizeTimeText } from '../../../shared/reminders';
import { normalizeDateText } from '../../../shared/calendar';
import { isTemplateNotePath } from '../../../shared/template-fields';
import type { TaskLinkKind } from '../../../shared/task-links';

/**
 * The one New Task dialog: every entry point — Ctrl+N on the Tasks
 * view, the Tasks view's New task button, the command palette, and the
 * grid context menu's Create task — opens this component through the
 * same opener, with the same fields and the same behavior.
 *
 * A task always lives in the Tasks notebook, as its own note, and only
 * links to the item it is associated with. Associating a task never
 * changes the associated note, file, or link. The Associate with
 * dropdown lists everything a task can be linked to: notes, files,
 * saved web links, and notebooks — or no association at all. Templates
 * are not notes, so they never appear here.
 */
export type TaskAssociationKind = 'note' | 'file' | 'link' | 'notebook';

export interface TaskAssociationOption {
  kind: TaskAssociationKind;
  path: string;
}

export interface TaskAssociationLink {
  kind: TaskLinkKind;
  target: string;
}

interface Props {
  options: TaskAssociationOption[];
  initialOption?: TaskAssociationOption;
  busy: boolean;
  error: string;
  priorityOptions?: string[];
  onClose: () => void;
  onCreate: (
    text: string,
    due: string,
    priority: string,
    reminder: string,
    link?: TaskAssociationLink,
  ) => Promise<void>;
}

const GROUP_LABELS: Record<TaskAssociationKind, string> = {
  note: 'Notes',
  file: 'Files',
  link: 'Links',
  notebook: 'Notebooks',
};

const GROUP_ORDER: TaskAssociationKind[] = ['note', 'file', 'link', 'notebook'];

function resolveSelection(
  options: TaskAssociationOption[],
  initialOption?: TaskAssociationOption,
): TaskAssociationOption | undefined {
  // No initial option means no association: the task just lives in the
  // Tasks notebook. A note is never picked for the user.
  if (
    initialOption &&
    options.some((option) => option.kind === initialOption.kind && option.path === initialOption.path)
  )
    return initialOption;
  return undefined;
}

export default function NewTaskDialog({
  options,
  initialOption,
  busy,
  error,
  priorityOptions,
  onClose,
  onCreate,
}: Props) {
  const priorityValues = priorityOptions?.length ? priorityOptions : ['critical', 'high', 'medium', 'low', 'optional'];
  // A template passed in by mistake is still not a note: it can never
  // be offered as an association.
  const visibleOptions = options.filter((option) => !(option.kind === 'note' && isTemplateNotePath(option.path)));
  const [selection, setSelection] = useState<TaskAssociationOption | undefined>(() =>
    resolveSelection(visibleOptions, initialOption),
  );
  // Until the user picks something, the selection follows the opener:
  // the initial option wins as soon as it arrives, then no association.
  // After the user chooses, their choice sticks and is only replaced
  // if it disappears — choosing no association never disappears.
  const userChoseRef = useRef(false);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [priority, setPriority] = useState(priorityValues.includes('medium') ? 'medium' : (priorityValues[0] ?? ''));
  const id = useId();
  const [localError, setLocalError] = useState('');
  useEffect(() => {
    setSelection((current) => {
      if (!userChoseRef.current) {
        const resolved = resolveSelection(visibleOptions, initialOption);
        if (resolved === undefined && current === undefined) return current;
        if (resolved && current && resolved.kind === current.kind && resolved.path === current.path) return current;
        return resolved;
      }
      if (current === undefined) return current;
      if (visibleOptions.some((option) => option.kind === current.kind && option.path === current.path)) return current;
      return resolveSelection(visibleOptions, initialOption);
    });
  }, [visibleOptions, initialOption]);
  // Every association is a link to the picked item — including a note.
  // The task itself always lives in the Tasks notebook, so no
  // association ever writes into the picked item.
  const link: TaskAssociationLink | undefined = selection
    ? {
        kind: selection.kind === 'note' ? 'note' : selection.kind === 'notebook' ? 'notebook' : 'file',
        target: selection.path,
      }
    : undefined;
  const grouped = GROUP_ORDER.map(
    (kind) => [kind, visibleOptions.filter((option) => option.kind === kind)] as const,
  ).filter(([, items]) => items.length > 0);
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
          if (text.trim() && !busy)
            void onCreate(
              text.trim(),
              normalizeDateText(due) ?? '',
              priority,
              reminderDate && reminderTime
                ? `${normalizeDateText(reminderDate) ?? ''}T${normalizeTimeText(reminderTime) ?? ''}`
                : '',
              link,
            );
        }}
      >
        <p>
          Tasks live in the Tasks notebook and link to the item you associate them with. The associated note, file, or
          link is never changed.
        </p>
        <label>
          Associate with
          <select
            data-autofocus
            value={selection ? selection.path : ''}
            disabled={busy}
            onChange={(event) => {
              userChoseRef.current = true;
              setSelection(visibleOptions.find((option) => option.path === event.target.value));
            }}
          >
            <option value="">No association</option>
            {grouped.map(([kind, items]) => (
              <optgroup key={kind} label={GROUP_LABELS[kind]}>
                {items.map((option) => (
                  <option key={`${option.kind}:${option.path}`} value={option.path}>
                    {option.path}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p>
          {selection
            ? `Task will be saved in the Tasks notebook and linked to ${selection.path}.`
            : 'Task will be saved in the Tasks notebook with no link.'}
        </p>
        <label>
          Task description
          <input
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
            {priorityValues.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        {localError || error ? <p role="alert">{localError || error}</p> : null}
        <button type="submit" disabled={busy || !text.trim()}>
          Create task
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
