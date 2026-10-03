import { useState } from 'react';
import Modal from '../../components/Modal';
import type { NoteConflict } from './open-note';

export default function ConflictDialog({
  conflict,
  onResolve,
}: {
  conflict: NoteConflict;
  onResolve: (choice: 'mine' | 'disk' | 'copy') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolve = (choice: 'mine' | 'disk' | 'copy') => {
    setBusy(true);
    void onResolve(choice)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title="Note changed on disk"
      titleId="conflict-title"
      onClose={() => {
        setError('Choose Keep mine, Load disk version, or Save copy to resolve the conflict.');
      }}
    >
      <p>
        {conflict.path} {conflict.disk === null ? 'was removed from the vault.' : 'changed outside the app.'} Your
        unsaved text is preserved.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <button data-autofocus type="button" disabled={busy || conflict.disk === null} onClick={() => resolve('mine')}>
        Keep mine
      </button>
      <button type="button" disabled={busy || conflict.disk === null} onClick={() => resolve('disk')}>
        Load disk version
      </button>
      <button type="button" disabled={busy} onClick={() => resolve('copy')}>
        Save copy
      </button>
    </Modal>
  );
}
