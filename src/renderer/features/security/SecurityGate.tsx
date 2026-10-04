import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  onUnlock: (password: string) => Promise<void>;
}

export default function SecurityGate({ onUnlock }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Vault locked" titleId="vault-lock-heading" onClose={() => undefined}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void onUnlock(password)
            .catch(() => setError('The password was incorrect or the vault security data is damaged.'))
            .finally(() => {
              setPassword('');
              setBusy(false);
            });
        }}
      >
        <label>
          Vault password
          <input
            autoComplete="current-password"
            data-autofocus
            type="password"
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || password.length < 8}>
          Unlock vault
        </button>
      </form>
    </Modal>
  );
}
