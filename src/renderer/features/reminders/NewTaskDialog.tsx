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
 * A task always lives as a checkbox in a note. The Associate with
 * dropdown lists everything a task can be associated with: notes that
 * can hold it, files, saved web links, and notebooks. Picking a note
 * saves the task there; picking a file, link, or notebook saves the
 * task in the holding note named underneath and links the task to the
 * picked item. Templates are not notes, so they never appear here.
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
  defaultHoldingNote?: string;
  busy: boolean;
  loadingNotes?: boolean;
  error: string;
  priorityOptions?: string[];
  onClose: () => void;
  onCreate: (
    holdingNote: string,
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
  if (
    initialOption &&
    options.some((option) => option.kind === initialOption.kind && option.path === initialOption.path)
  )
    return initialOption;
  return options.find((option) => option.kind === 'note') ?? options[0];
}

export default function NewTaskDialog({
  options,
  initialOption,
  defaultHoldingNote,
  busy,
  loadingNotes = false,
  error,
  priorityOptions,
  onClose,
  onCreate,
}: Props) {
  const priorityValues = priorityOptions?.length ? priorityOptions : ['critical', 'high', 'medium', 'low', 'optional'];
  // A template passed in by mistake is still not a note: it can neither
  // hold the task nor be offered as an association.
  const visibleOptions = options.filter((option) => !(option.kind === 'note' && isTemplateNotePath(option.path)));
  const noteOptions = visibleOptions.filter((option) => option.kind === 'note');
  const [selection, setSelection] = useState<TaskAssociationOption | undefined>(() =>
    resolveSelection(visibleOptions, initialOption),
  );
  // Until the user picks something, the selection follows the opener:
  // the initial option wins as soon as it arrives (notes load after
  // the dialog opens), then the first note. After the user chooses,
  // their choice sticks and is only replaced if it disappears.
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
        if (resolved && current && resolved.kind === current.kind && resolved.path === current.path) return current;
        return resolved;
      }
      if (current && visibleOptions.some((option) => option.kind === current.kind && option.path === current.path))
        return current;
      return resolveSelection(visibleOptions, initialOption);
    });
  }, [visibleOptions, initialOption]);
  const holdingNote =
    selection?.kind === 'note'
      ? selection.path
      : defaultHoldingNote && noteOptions.some((option) => option.path === defaultHoldingNote)
        ? defaultHoldingNote
        : (noteOptions[0]?.path ?? '');
  const link: TaskAssociationLink | undefined =
    selection && selection.kind !== 'note'
      ? { kind: selection.kind === 'notebook' ? 'notebook' : 'file', target: selection.path }
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
          if (holdingNote && text.trim() && !busy && !loadingNotes)
            void onCreate(
              holdingNote,
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
        <p>Tasks are saved as checkboxes in their associated note.</p>
        <p>Only unencrypted notes can hold a task. Templates and cognitive tool files are excluded.</p>
        {!noteOptions.length ? (
          <p>{loadingNotes ? 'Checking eligible notes…' : 'Create an unencrypted note before adding a task.'}</p>
        ) : null}
        {noteOptions.length || loadingNotes ? (
          <label>
            Associate with
            <select
              required
              value={selection ? selection.path : ''}
              disabled={busy || loadingNotes}
              onChange={(event) => {
                const next = visibleOptions.find((option) => option.path === event.target.value);
                if (next) {
                  userChoseRef.current = true;
                  setSelection(next);
                }
              }}
            >
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
        ) : null}
        {selection && selection.kind !== 'note' && holdingNote ? (
          <p>
            Task will be saved in {holdingNote} and linked to {selection.path}.
          </p>
        ) : null}
        <label>
          Task description
          <input
            data-autofocus
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
        <button type="submit" disabled={busy || loadingNotes || !holdingNote || !text.trim()}>
          Create task
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
