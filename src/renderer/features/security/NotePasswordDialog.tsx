import { useState } from 'react';
import Modal from '../../components/Modal';

const PASSWORD_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';

export function generateNotePassword(length = 24) {
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error('Password length must be 8–128.');
  const maximum = Math.floor(256 / PASSWORD_CHARACTERS.length) * PASSWORD_CHARACTERS.length;
  let result = '';
  while (result.length < length) {
    const random = crypto.getRandomValues(new Uint8Array(Math.max(16, length - result.length)));
    for (const value of random) {
      if (value >= maximum) continue;
      result += PASSWORD_CHARACTERS[value % PASSWORD_CHARACTERS.length];
      if (result.length === length) break;
    }
  }
  return result;
}

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
  const [clipboardMessage, setClipboardMessage] = useState('');
  const [generated, setGenerated] = useState(false);
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
            onChange={(event) => {
              setGenerated(false);
              setPassword(event.target.value);
            }}
          />
        </label>
        {encrypting ? (
          <>
            <button
              type="button"
              onClick={() => {
                const next = generateNotePassword();
                setPassword(next);
                setConfirmation(next);
                setGenerated(true);
                setClipboardMessage('');
              }}
            >
              Generate password
            </button>
            {generated ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    setClipboardMessage(
                      'Password copied. It will be cleared from the clipboard in 30 seconds if unchanged.',
                    );
                    window.setTimeout(() => {
                      void navigator.clipboard
                        .readText()
                        .then((current) => {
                          if (current === password) return navigator.clipboard.writeText('');
                        })
                        .catch(() => undefined);
                    }, 30_000);
                  } catch {
                    setClipboardMessage('Could not copy the generated password.');
                  }
                }}
              >
                Copy generated password
              </button>
            ) : null}
            {clipboardMessage ? <p role="status">{clipboardMessage}</p> : null}
          </>
        ) : null}
        {encrypting ? (
          <label>
            Confirm note password
            <input
              autoComplete="new-password"
              type="password"
              maxLength={1024}
              value={confirmation}
              onChange={(event) => {
                setGenerated(false);
                setConfirmation(event.target.value);
              }}
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
