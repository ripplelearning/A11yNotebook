import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  action: 'encrypt' | 'unlock';
  noteName: string;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}

export default function NotePasswordDialog({ action, noteName, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const encrypting = action === 'encrypt';
  return (
    <Modal
      title={encrypting ? 'Encrypt note' : 'Unlock encrypted note'}
      titleId="note-password-heading"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void onSubmit(password)
            .catch((failure: unknown) =>
              setError(failure instanceof Error ? failure.message : 'Could not process this note password.'),
            )
            .finally(() => {
              setPassword('');
              setConfirmation('');
              setBusy(false);
            });
        }}
      >
        <p>{encrypting ? `Choose a password for ${noteName}.` : `Enter the password for ${noteName}.`}</p>
        <label>
          Note password
          <input
            autoComplete={encrypting ? 'new-password' : 'current-password'}
            data-autofocus
            type="password"
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {encrypting ? (
          <label>
            Confirm note password
            <input
              autoComplete="new-password"
              type="password"
              maxLength={1024}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || password.length < 8 || password.length > 1024 || (encrypting && password !== confirmation)}
        >
          {encrypting ? 'Encrypt note' : 'Unlock note'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
