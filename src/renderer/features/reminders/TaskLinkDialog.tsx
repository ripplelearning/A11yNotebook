import { useState } from 'react';
import Modal from '../../components/Modal';
import type { TaskLinkKind } from '../../../shared/task-links';
import type { VaultTask } from '../../../shared/types';

const KIND_TITLES: Record<TaskLinkKind, string> = {
  note: 'Link to note',
  file: 'Link to file',
  notebook: 'Link to Notebook',
};

interface Props {
  task: VaultTask;
  kind: TaskLinkKind;
  targets: string[];
  onSave: (target: string) => Promise<void>;
  onClose: () => void;
}

export default function TaskLinkDialog({ task, kind, targets, onSave, onClose }: Props) {
  const [selected, setSelected] = useState(targets[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal title={KIND_TITLES[kind]} titleId="task-link-title" onClose={close}>
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
        <p>
          Link task “{task.text}” to a {kind === 'notebook' ? 'notebook' : kind}:
        </p>
        {targets.length ? (
          <label>
            {kind === 'notebook' ? 'Notebook' : kind === 'note' ? 'Note' : 'File'}
            <select
              data-autofocus
              value={selected}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p role="status">There is nothing to link to yet.</p>
        )}
        {error ? (
          <p role="alert">{error}</p>
        ) : null}
        <button type="submit" disabled={busy || !selected}>
          Link
        </button>{' '}
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
