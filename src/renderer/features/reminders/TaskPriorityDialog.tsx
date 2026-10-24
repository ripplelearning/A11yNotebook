import { useState } from 'react';
import Modal from '../../components/Modal';
import { formatPriorityName } from '../../../shared/settings';
import type { VaultTask } from '../../../shared/types';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;

interface Props {
  task: VaultTask;
  options: string[];
  onSave: (priority: string) => Promise<void>;
  onOptionsChange: (options: string[]) => Promise<void>;
  onClose: () => void;
}

export default function TaskPriorityDialog({ task, options, onSave, onOptionsChange, onClose }: Props) {
  // Stored values are lowercase single words; display capitalizes them.
  const normalizedOptions = Array.from(new Set(options.map((option) => option.toLowerCase())));
  const currentPriority = task.priority?.toLowerCase();
  const initialOptions =
    currentPriority && !normalizedOptions.includes(currentPriority)
      ? [currentPriority, ...normalizedOptions]
      : normalizedOptions;
  const [currentOptions, setCurrentOptions] = useState<string[]>(initialOptions);
  const [selected, setSelected] = useState(currentPriority ?? initialOptions[0] ?? '');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manageError, setManageError] = useState('');

  const close = () => {
    if (!busy) onClose();
  };

  const applyOptions = async (next: string[]) => {
    setCurrentOptions(next);
    if (!next.some((option) => option.toLowerCase() === selected.toLowerCase())) {
      setSelected(next[0] ?? '');
    }
    await onOptionsChange(next);
  };

  const validateName = (name: string, except?: string): string | null => {
    if (!NAME_PATTERN.test(name)) {
      return 'Priority names use one word of letters, digits, hyphens, or underscores (up to 30 characters).';
    }
    if (currentOptions.some((option) => option === name && option !== except)) {
      return 'That priority option already exists.';
    }
    return null;
  };

  return (
    <Modal title="Set priority" titleId="task-priority-title" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !selected) return;
          setBusy(true);
          setError('');
          void onSave(selected)
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Priority
          <select
            data-autofocus
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(event.target.value)}
          >
            {currentOptions.map((option) => (
              <option key={option} value={option}>
                {formatPriorityName(option)}
              </option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !selected}>
          Set priority
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
      <section aria-labelledby="manage-priorities-title">
        <h2 id="manage-priorities-title">Priority options</h2>
        <p>Priority names are single words so they survive in task lines.</p>
        <ul>
          {currentOptions.map((option) => (
            <li key={option}>
              {editing === option ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const problem = validateName(editName.trim().toLowerCase(), option);
                    if (problem) {
                      setManageError(problem);
                      return;
                    }
                    setManageError('');
                    const next = currentOptions.map((item) => (item === option ? editName.trim().toLowerCase() : item));
                    if (selected === option) setSelected(editName.trim().toLowerCase());
                    setEditing(null);
                    void applyOptions(next).catch((failure: Error) => setManageError(failure.message));
                  }}
                >
                  <label>
                    Rename {formatPriorityName(option)}
                    <input
                      data-autofocus
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </label>
                  <button type="submit">Save name</button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  {formatPriorityName(option)}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(option);
                      setEditName(option);
                      setManageError('');
                    }}
                  >
                    Rename
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() => {
                      if (currentOptions.length <= 1) {
                        setManageError('Keep at least one priority option.');
                        return;
                      }
                      setManageError('');
                      void applyOptions(currentOptions.filter((item) => item !== option)).catch((failure: Error) =>
                        setManageError(failure.message),
                      );
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateName(newName.trim().toLowerCase());
            if (problem) {
              setManageError(problem);
              return;
            }
            setManageError('');
            const name = newName.trim().toLowerCase();
            setNewName('');
            void applyOptions([...currentOptions, name]).catch((failure: Error) => setManageError(failure.message));
          }}
        >
          <label>
            Add a priority option
            <input value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <button type="submit">Add option</button>
        </form>
        {manageError ? <p role="alert">{manageError}</p> : null}
      </section>
    </Modal>
  );
}
