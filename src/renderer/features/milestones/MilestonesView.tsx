import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Milestone, NewMilestone } from '../../../shared/milestones';
import type { VaultTask } from '../../../shared/types';
import Modal from '../../components/Modal';
import MilestoneDialog, { associationKey, taskReference } from './MilestoneDialog';

export default function MilestonesView({
  vaultPath,
  notePaths,
  isCurrent,
  onOpenNote,
  announce,
}: {
  vaultPath: string;
  notePaths: string[];
  isCurrent: () => boolean;
  onOpenNote: (path: string, canContinue: () => boolean) => Promise<void>;
  announce: (message: string) => void;
}) {
  const id = useId();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const alive = useRef(false);
  const operation = useRef(false);
  const request = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);
  const currentRef = useRef(isCurrent);
  currentRef.current = isCurrent;
  const current = useCallback(() => alive.current && currentRef.current(), []);
  const bridge = window.a11yNotebook?.vault;
  const available = !!(
    bridge?.getMilestones &&
    bridge.createMilestone &&
    bridge.updateMilestone &&
    bridge.deleteMilestone
  );

  const refresh = useCallback(async () => {
    if (!current() || operation.current) return;
    const version = ++request.current;
    setLoading(true);
    try {
      if (!bridge?.getMilestones) throw new Error('Milestone planning is unavailable in this version.');
      const [items, latestTasks] = await Promise.all([bridge.getMilestones(), bridge.getTasks()]);
      if (!current() || version !== request.current) return;
      setMilestones(items);
      setTasks(latestTasks);
      setError('');
    } catch (reason) {
      if (current() && version === request.current)
        setError(reason instanceof Error ? reason.message : 'Could not load milestones.');
    } finally {
      if (current() && version === request.current) setLoading(false);
    }
  }, [bridge, current]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = bridge?.onChanged?.((event) => {
      if (event.vaultPath === vaultPath) void refresh();
    });
    const unsubscribeLock = bridge?.onSecurityLocked?.(() => {
      alive.current = false;
      request.current += 1;
      setMilestones([]);
      setTasks([]);
      setEditing(null);
      setDeleting(null);
      setSelectedId(null);
      setError('');
      setNotice('');
    });
    return () => {
      alive.current = false;
      request.current += 1;
      unsubscribe?.();
      unsubscribeLock?.();
    };
  }, [bridge, refresh, vaultPath]);

  useEffect(() => {
    if (selectedId && !document.querySelector('[role="dialog"]')) detailRef.current?.focus();
  }, [selectedId]);
  const selected = milestones.find((item) => item.id === selectedId);
  const visible = milestones
    .filter((item) => filter === 'all' || item.status === filter)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));

  async function mutate(action: () => Promise<Milestone | void>, message: string) {
    if (!current()) throw new Error('The vault is no longer available.');
    if (operation.current) throw new Error('Wait for the current milestone operation.');
    operation.current = true;
    request.current += 1;
    setBusy(true);
    setLoading(false);
    setError('');
    let succeeded = false;
    try {
      const saved = await action();
      if (!current()) return;
      if (saved) {
        setMilestones((items) => [...items.filter((item) => item.id !== saved.id), saved]);
        setSelectedId(saved.id);
      } else if (deleting) {
        setMilestones((items) => items.filter((item) => item.id !== deleting.id));
        setSelectedId(null);
      }
      setNotice(message);
      announce(message);
      succeeded = true;
    } finally {
      operation.current = false;
      if (current()) {
        setBusy(false);
        if (succeeded) void refresh();
      }
    }
  }

  async function save(input: NewMilestone) {
    if (!bridge?.createMilestone || !bridge.updateMilestone) throw new Error('Milestone planning is unavailable.');
    const target = editing;
    await mutate(
      () => (target && target !== 'new' ? bridge.updateMilestone!(target.id, input) : bridge.createMilestone!(input)),
      target === 'new' ? 'Milestone created.' : 'Milestone updated.',
    );
  }

  async function open(path: string) {
    if (!current()) return;
    try {
      await onOpenNote(path, current);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Could not open associated note.');
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} aria-busy={loading || busy}>
      <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1}>
        Milestones
      </h2>
      <button type="button" disabled={!available || loading || busy} onClick={() => setEditing('new')}>
        Create milestone
      </button>
      <button type="button" disabled={busy || loading} onClick={() => void refresh()}>
        Refresh milestones
      </button>
      <label htmlFor={`${id}-filter`}>Filter milestone status</label>
      <select id={`${id}-filter`} value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">All statuses</option>
        <option value="planned">Planned</option>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </select>
      {loading && <p role="status">Loading milestones…</p>}
      {notice && <p>{notice}</p>}
      {error && !deleting && <p role="alert">{error}</p>}
      {!loading && !visible.length && <p>No milestones match this view.</p>}
      {!!visible.length && (
        <table>
          <caption>Milestone plans, ordered by due date</caption>
          <thead>
            <tr>
              <th scope="col">Milestone</th>
              <th scope="col">Due date</th>
              <th scope="col">Status</th>
              <th scope="col">Task progress</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <th scope="row">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      detailRef.current?.focus();
                    }}
                  >
                    {item.title}
                  </button>
                </th>
                <td>
                  <time dateTime={item.dueDate}>{item.dueDate}</time>
                </td>
                <td>{item.status}</td>
                <td>
                  {item.progress.summary} ({item.progress.percentage}%)
                  {item.progress.missing ? `; ${item.progress.missing} unavailable` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && (
        <section aria-labelledby={`${id}-detail`}>
          <h3 ref={detailRef} id={`${id}-detail`} tabIndex={-1}>
            {selected.title}
          </h3>
          <p>
            Due <time dateTime={selected.dueDate}>{selected.dueDate}</time> — {selected.status}
          </p>
          <p>
            {selected.progress.summary} ({selected.progress.percentage}%); {selected.progress.missing} unavailable
            tasks.
          </p>
          <progress
            aria-label={`Task progress for ${selected.title}`}
            value={selected.progress.completed}
            max={selected.progress.total || 1}
          />
          <p>Milestone status is set manually; task progress follows saved task completion.</p>
          <button type="button" disabled={!available || loading || busy} onClick={() => setEditing(selected)}>
            Edit milestone
          </button>
          <button type="button" disabled={!available || loading || busy} onClick={() => setDeleting(selected)}>
            Delete milestone
          </button>
          <h4>Associated notes</h4>
          {selected.notePaths.length ? (
            <ul>
              {selected.notePaths.map((path) => (
                <li key={path}>
                  {notePaths.includes(path) ? (
                    <button type="button" onClick={() => void open(path)}>
                      {path}
                    </button>
                  ) : (
                    `${path} (unavailable)`
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No associated notes.</p>
          )}
          <h4>Associated tasks</h4>
          {selected.tasks.length ? (
            <ul>
              {selected.tasks.map((reference) => {
                const matches = tasks.filter(
                  (task) => associationKey(taskReference(task)) === associationKey(reference),
                );
                const task = matches.length === 1 ? matches[0] : undefined;
                return (
                  <li key={associationKey(reference)}>
                    {task ? (
                      <button type="button" onClick={() => void open(reference.path)}>
                        {task.text} — {reference.path} ({task.complete ? 'complete' : 'open'})
                      </button>
                    ) : (
                      `Unavailable task — ${reference.path} — ${reference.taskId}`
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No associated tasks.</p>
          )}
        </section>
      )}
      {editing && (
        <MilestoneDialog
          milestone={editing === 'new' ? undefined : editing}
          notePaths={notePaths}
          tasks={tasks}
          onSave={save}
          onClose={(saved) => {
            setEditing(null);
            if (saved)
              window.setTimeout(() => {
                if (current()) detailRef.current?.focus();
              }, 0);
          }}
        />
      )}
      {deleting && (
        <Modal
          titleId={`${id}-delete`}
          title="Delete milestone?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>Delete “{deleting.title}”? Associated notes and tasks will not be deleted. This cannot be undone.</p>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Deleting milestone. Please wait.</p>}
          <button type="button" data-autofocus={!busy || undefined} disabled={busy} onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void mutate(async () => {
                if (!bridge?.deleteMilestone) throw new Error('Milestone planning is unavailable.');
                await bridge.deleteMilestone(deleting.id);
              }, 'Milestone deleted.')
                .then(() => {
                  if (!current()) return;
                  setDeleting(null);
                  window.setTimeout(() => {
                    if (current()) headingRef.current?.focus();
                  }, 0);
                })
                .catch((reason: unknown) => {
                  if (current()) setError(reason instanceof Error ? reason.message : 'Could not delete milestone.');
                });
            }}
          >
            Confirm delete milestone
          </button>
        </Modal>
      )}
    </section>
  );
}
