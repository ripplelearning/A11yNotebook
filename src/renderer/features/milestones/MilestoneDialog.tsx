import { useEffect, useId, useRef, useState } from 'react';
import type { Milestone, MilestoneTaskAssociation, NewMilestone } from '../../../shared/milestones';
import type { VaultTask } from '../../../shared/types';
import Modal from '../../components/Modal';

export function taskReference(task: VaultTask): MilestoneTaskAssociation {
  return { path: task.path, taskId: task.taskId ?? task.id };
}

export function associationKey(task: MilestoneTaskAssociation) {
  return `${task.path}\0${task.taskId}`;
}

export default function MilestoneDialog({
  milestone,
  notePaths,
  tasks,
  onSave,
  onClose,
}: {
  milestone?: Milestone;
  notePaths: string[];
  tasks: VaultTask[];
  onSave: (input: NewMilestone) => Promise<void>;
  onClose: (saved?: boolean) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? '');
  const [status, setStatus] = useState<NewMilestone['status']>(milestone?.status ?? 'planned');
  const [notes, setNotes] = useState(milestone?.notePaths ?? []);
  const [associations, setAssociations] = useState(milestone?.tasks ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const availableTasks = tasks.map((task) => ({
    reference: taskReference(task),
    label: `${task.text} — ${task.path}${task.complete ? ' (complete)' : ''}`,
  }));
  const uniqueTasks = availableTasks.filter(
    (task) =>
      availableTasks.filter((candidate) => associationKey(candidate.reference) === associationKey(task.reference))
        .length === 1,
  );
  const choices = [
    ...uniqueTasks,
    ...associations
      .filter((reference) => !uniqueTasks.some((task) => associationKey(task.reference) === associationKey(reference)))
      .map((reference) => ({
        reference,
        label: `Unavailable task — ${reference.path} — ${reference.taskId}`,
      })),
  ];
  function close() {
    if (saving.current) return;
    mounted.current = false;
    onClose();
  }
  return (
    <Modal titleId={`${id}-title`} title={milestone ? 'Edit milestone' : 'Create milestone'} onClose={close}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current) return;
          const date = new Date(`${dueDate}T00:00:00.000Z`);
          if (
            !title.trim() ||
            title.trim().length > 500 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
            !Number.isFinite(date.getTime()) ||
            date.toISOString().slice(0, 10) !== dueDate
          ) {
            setError('Enter a title of 1–500 characters and a valid due date.');
            return;
          }
          if (notes.length > 1000 || associations.length > 1000) {
            setError('Select no more than 1,000 notes and 1,000 tasks.');
            return;
          }
          saving.current = true;
          setBusy(true);
          setError('');
          void onSave({ title: title.trim(), dueDate, status, notePaths: notes, tasks: associations })
            .then(() => {
              if (mounted.current) onClose(true);
            })
            .catch((reason: unknown) => {
              if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save milestone.');
            })
            .finally(() => {
              saving.current = false;
              if (mounted.current) setBusy(false);
            });
        }}
      >
        <fieldset disabled={busy}>
          <legend>Milestone plan</legend>
          <label htmlFor={`${id}-name`}>Milestone title</label>
          <input
            id={`${id}-name`}
            data-autofocus={!busy || undefined}
            disabled={busy}
            value={title}
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <label htmlFor={`${id}-date`}>Due date</label>
          <input
            id={`${id}-date`}
            type="date"
            disabled={busy}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            required
          />
          <label htmlFor={`${id}-status`}>Milestone status</label>
          <select
            id={`${id}-status`}
            value={status}
            disabled={busy}
            onChange={(event) => setStatus(event.target.value as NewMilestone['status'])}
          >
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <fieldset>
            <legend>Associated notes</legend>
            {[...new Set([...notePaths, ...notes])].map((path) => (
              <label key={path}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={notes.includes(path)}
                  onChange={(event) =>
                    setNotes((current) =>
                      event.target.checked ? [...current, path] : current.filter((item) => item !== path),
                    )
                  }
                />
                {path}
                {!notePaths.includes(path) ? ' (unavailable)' : ''}
              </label>
            ))}
            {!notePaths.length && !notes.length && <p>No notes available.</p>}
          </fieldset>
          <fieldset>
            <legend>Associated tasks</legend>
            <p>Progress follows saved tasks. Associating a Markdown task may add a stable identity to its note.</p>
            {uniqueTasks.length !== availableTasks.length && (
              <p>
                Tasks with ambiguous identities cannot be added. Resolve duplicate task identities in the source note
                first.
              </p>
            )}
            {choices.map(({ reference, label }) => (
              <label key={associationKey(reference)}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={associations.some((item) => associationKey(item) === associationKey(reference))}
                  onChange={(event) =>
                    setAssociations((current) =>
                      event.target.checked
                        ? [...current, reference]
                        : current.filter((item) => associationKey(item) !== associationKey(reference)),
                    )
                  }
                />
                {label}
              </label>
            ))}
            {!choices.length && <p>No tasks available.</p>}
          </fieldset>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Saving milestone. Please wait.</p>}
        <div className="modal-actions">
          <button type="submit" disabled={busy}>
            Save milestone
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
