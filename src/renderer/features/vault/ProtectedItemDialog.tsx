import { useState } from 'react';
import Modal from '../../components/Modal';

export type ProtectedAction = 'edit' | 'rename' | 'move' | 'delete' | 'delete-permanent';

interface Props {
  itemName: string;
  blockingName: string;
  blockingIsTarget: boolean;
  action: ProtectedAction;
  onUnprotect: () => Promise<void>;
  onCancel: () => void;
}

const ACTION_PHRASE: Record<ProtectedAction, string> = {
  edit: 'edit it',
  rename: 'rename it',
  move: 'move it',
  delete: 'delete it',
  'delete-permanent': 'delete it',
};

/**
 * Shown whenever an edit, rename, move, or delete is attempted on a
 * protected item. Unprotect carries out the original action; Cancel
 * aborts it and leaves the protection in place.
 */
export default function ProtectedItemDialog({
  itemName,
  blockingName,
  blockingIsTarget,
  action,
  onUnprotect,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const phrase = ACTION_PHRASE[action];
  return (
    <Modal title="Protected item" titleId="protected-item-title" onClose={onCancel}>
      {blockingIsTarget ? (
        <p>
          “{blockingName}” is protected. Unprotect it to {phrase}?
        </p>
      ) : (
        <p>
          “{itemName}” contains the protected item “{blockingName}”. Unprotect “{blockingName}” to {phrase}?
        </p>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : null}
      <button
        type="button"
        data-default
        data-autofocus
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void onUnprotect().catch(() => {
            setBusy(false);
            setError('Could not unprotect this item.');
          });
        }}
      >
        Unprotect
      </button>{' '}
      <button type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
