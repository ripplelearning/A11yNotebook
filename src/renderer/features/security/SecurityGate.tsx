import { useEffect, useRef, useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  onUnlock: (password: string) => Promise<void>;
  recoveryAvailable?: boolean;
  onRecover?: (recoveryKey: string, newPassword: string) => Promise<void>;
}

export default function SecurityGate({ onUnlock, recoveryAvailable = false, onRecover }: Props) {
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const recoveryInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (recovering) recoveryInput.current?.focus();
  }, [recovering]);
  return (
    <Modal title="Vault locked" titleId="vault-lock-heading" onClose={() => undefined}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const operation = recovering
            ? onRecover?.(recoveryKey, newPassword).then(() => {
                setRecoveryKey('');
                setNewPassword('');
                setConfirmPassword('');
              })
            : onUnlock(password);
          void Promise.resolve(operation)
            .catch(() =>
              setError(
                recovering
                  ? 'Recovery failed. Check the recovery key and try again.'
                  : 'The password was incorrect or the vault security data is damaged.',
              ),
            )
            .finally(() => {
              setPassword('');
              setBusy(false);
            });
        }}
      >
        {recovering ? (
          <>
            <h3>Recover vault password</h3>
            <p>
              Use the recovery key you saved when enabling recovery. This resets the vault password; separately
              password-encrypted notes still require their own passwords.
            </p>
            <label>
              Vault recovery key
              <input
                ref={recoveryInput}
                autoComplete="off"
                data-autofocus
                maxLength={43}
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value)}
              />
            </label>
            <label>
              New vault password (at least 8 characters)
              <input
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new vault password
              <input
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || recoveryKey.length !== 43 || newPassword.length < 8 || newPassword !== confirmPassword}>
              Reset password and unlock
            </button>
            <button type="button" disabled={busy} onClick={() => setRecovering(false)}>
              Return to password sign-in
            </button>
          </>
        ) : (
          <>
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
            <button type="submit" disabled={busy || password.length < 8}>
              Unlock vault
            </button>
            {recoveryAvailable && onRecover ? (
              <button type="button" disabled={busy} onClick={() => setRecovering(true)}>
                Use recovery key
              </button>
            ) : null}
          </>
        )}
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
