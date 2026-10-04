import { useEffect, useState } from 'react';
import { COMMANDS } from '../../../shared/command-registry';
import { DEFAULT_SETTINGS, validateSettings, type NotebookSettings } from '../../../shared/settings';
import Modal from '../../components/Modal';

interface Props {
  settings: NotebookSettings;
  onSave: (settings: NotebookSettings) => Promise<void>;
  onClose: () => void;
  securityEnabled?: boolean;
  onSetVaultPassword?: (password: string) => Promise<void>;
  onLockVault?: () => Promise<void>;
  onSaveCredential?: (id: string, username: string, password: string) => Promise<void>;
  onDeleteCredential?: (id: string) => Promise<void>;
}

export default function SettingsDialog({
  settings,
  onSave,
  onClose,
  securityEnabled = false,
  onSetVaultPassword,
  onLockVault,
  onSaveCredential,
  onDeleteCredential,
}: Props) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('');
  const [credentials, setCredentials] = useState<{ id: string; username: string; password: string }[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  useEffect(() => {
    const readCredentials = window.a11yNotebook?.vault.readCredentials;
    if (!securityEnabled || !readCredentials) return;
    void readCredentials()
      .then(setCredentials)
      .catch(() => setError('Could not read encrypted credentials.'));
  }, [securityEnabled]);
  return (
    <Modal title="Settings" titleId="settings-heading" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const validated = validateSettings(draft);
            setSaving(true);
            void onSave(validated)
              .then(onClose)
              .catch(() => setError('Could not save settings.'))
              .finally(() => setSaving(false));
          } catch (failure) {
            setError((failure as Error).message);
          }
        }}
      >
        <label>
          Autosave delay in milliseconds (0 disables autosave)
          <input
            data-autofocus
            type="number"
            min={0}
            max={60000}
            value={draft.autosaveDelay}
            onChange={(event) => setDraft({ ...draft, autosaveDelay: Number(event.target.value) })}
          />
        </label>
        <label>
          Theme
          <select
            value={draft.theme}
            onChange={(event) => setDraft({ ...draft, theme: event.target.value as NotebookSettings['theme'] })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </label>
        <label>
          Font size
          <input
            type="number"
            min={12}
            max={32}
            value={draft.fontSize}
            onChange={(event) => setDraft({ ...draft, fontSize: Number(event.target.value) })}
          />
        </label>
        <label>
          Vault idle lock in minutes (0 disables; maximum 240)
          <input
            type="number"
            min={0}
            max={240}
            value={draft.vaultLockMinutes ?? 15}
            onChange={(event) => setDraft({ ...draft, vaultLockMinutes: Number(event.target.value) })}
          />
        </label>
        <label>
          Lock editing after unsaved changes in minutes (0 disables; maximum 240)
          <input
            type="number"
            min={0}
            max={240}
            value={draft.noteEditLockMinutes ?? 0}
            onChange={(event) => setDraft({ ...draft, noteEditLockMinutes: Number(event.target.value) })}
          />
        </label>
        <fieldset>
          <legend>Keyboard shortcuts</legend>
          <p>Leave a shortcut empty to disable it. Pane and tab navigation keys are reserved.</p>
          {COMMANDS.map((command) => (
            <label key={command.id}>
              {command.label}
              <input
                value={draft.shortcuts[command.id] ?? command.shortcut ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, shortcuts: { ...draft.shortcuts, [command.id]: event.target.value } })
                }
              />
            </label>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, shortcuts: {} })}>
            Reset shortcuts to defaults
          </button>
        </fieldset>
        <fieldset>
          <legend>Vault security</legend>
          <p>
            {securityEnabled
              ? 'This vault is password protected. The password cannot be recovered if it is lost.'
              : 'Set a password to require authentication when opening this vault. This does not encrypt unmarked notes.'}
          </p>
          {!securityEnabled && onSetVaultPassword ? (
            <>
              <label>
                New vault password (at least 8 characters)
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1024}
                  value={vaultPassword}
                  onChange={(event) => setVaultPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm vault password
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1024}
                  value={vaultPasswordConfirm}
                  onChange={(event) => setVaultPasswordConfirm(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={vaultPassword.length < 8 || vaultPassword !== vaultPasswordConfirm}
                onClick={() => {
                  void onSetVaultPassword(vaultPassword)
                    .then(() => {
                      setVaultPassword('');
                      setVaultPasswordConfirm('');
                      setError('Vault password protection enabled.');
                    })
                    .catch(() => setError('Could not enable vault password protection.'));
                }}
              >
                Set vault password
              </button>
            </>
          ) : null}
          {securityEnabled && onLockVault ? (
            <button type="button" onClick={() => void onLockVault().catch(() => setError('Could not lock vault.'))}>
              Lock vault now
            </button>
          ) : null}
          {securityEnabled && onSaveCredential && onDeleteCredential ? (
            <>
              <h3>Encrypted service credentials</h3>
              <ul>
                {credentials.map((credential) => (
                  <li key={credential.id}>
                    {credential.id} — {credential.username}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        void onDeleteCredential(credential.id)
                          .then(() => setCredentials((items) => items.filter((item) => item.id !== credential.id)))
                          .catch(() => setError('Could not remove credential.'));
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
              <label>
                Service name
                <input maxLength={120} value={credentialId} onChange={(event) => setCredentialId(event.target.value)} />
              </label>
              <label>
                Username
                <input
                  maxLength={500}
                  value={credentialUsername}
                  onChange={(event) => setCredentialUsername(event.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={4096}
                  value={credentialPassword}
                  onChange={(event) => setCredentialPassword(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!credentialId.trim() || !credentialPassword}
                onClick={() => {
                  void onSaveCredential(credentialId, credentialUsername, credentialPassword)
                    .then(() => {
                      setCredentials((items) => [
                        ...items.filter((item) => item.id !== credentialId.trim()),
                        { id: credentialId.trim(), username: credentialUsername, password: credentialPassword },
                      ]);
                      setCredentialId('');
                      setCredentialUsername('');
                      setCredentialPassword('');
                    })
                    .catch(() => setError('Could not save credential.'));
                }}
              >
                Save encrypted credential
              </button>
            </>
          ) : null}
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={saving}>
          Save settings
        </button>
        <button type="button" onClick={() => setDraft(DEFAULT_SETTINGS)}>
          Reset all settings
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
