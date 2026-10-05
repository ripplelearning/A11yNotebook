import { useEffect, useRef, useState } from 'react';
import { COMMANDS } from '../../../shared/command-registry';
import { DEFAULT_SETTINGS, validateSettings, type NotebookSettings } from '../../../shared/settings';
import Modal from '../../components/Modal';
import {
  refreshPdfReadingPreferences,
  savePdfReadingPreferences,
  usePdfReadingPreferences,
} from '../../hooks/usePdfReadingPreferences';
import type { PdfReadingPreferences } from '../../../shared/pdf-reading-preferences';

interface Props {
  settings: NotebookSettings;
  onSave: (settings: NotebookSettings) => Promise<void>;
  onClose: () => void;
  securityEnabled?: boolean;
  recoveryAvailable?: boolean;
  onSetVaultPassword?: (password: string) => Promise<void>;
  onPrepareRecovery?: (password: string) => Promise<string>;
  onAcknowledgeRecovery?: () => Promise<void>;
  onRevokeRecovery?: (password: string) => Promise<void>;
  onLockVault?: () => Promise<void>;
  onSaveCredential?: (id: string, username: string, password: string) => Promise<void>;
  onDeleteCredential?: (id: string) => Promise<void>;
}

export default function SettingsDialog({
  settings,
  onSave,
  onClose,
  securityEnabled = false,
  recoveryAvailable = false,
  onSetVaultPassword,
  onPrepareRecovery,
  onAcknowledgeRecovery,
  onRevokeRecovery,
  onLockVault,
  onSaveCredential,
  onDeleteCredential,
}: Props) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [revokePassword, setRevokePassword] = useState('');
  const recoveryKeyInput = useRef<HTMLInputElement>(null);
  const [credentials, setCredentials] = useState<{ id: string; username: string; password: string }[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  const pdfPreferences = usePdfReadingPreferences();
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [pdfConfirmation, setPdfConfirmation] = useState('');
  useEffect(() => {
    let cancelled = false;
    void refreshPdfReadingPreferences()
      .catch(() => {
        if (!cancelled) setError('Could not load PDF reading preferences.');
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!pdfConfirmation) return;
    const timer = window.setTimeout(() => setPdfConfirmation(''), 3000);
    return () => window.clearTimeout(timer);
  }, [pdfConfirmation]);
  useEffect(() => {
    if (recoveryKey) recoveryKeyInput.current?.focus();
  }, [recoveryKey]);
  function updatePdfPreference(key: keyof PdfReadingPreferences, checked: boolean) {
    setPdfSaving(true);
    setPdfConfirmation('');
    void savePdfReadingPreferences({ ...pdfPreferences, [key]: checked })
      .then(() => setPdfConfirmation('PDF reading preferences saved.'))
      .catch(() => setError('Could not save PDF reading preferences.'))
      .finally(() => setPdfSaving(false));
  }
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
        <fieldset aria-describedby="pdf-reading-help" disabled={pdfLoading || pdfSaving}>
          <legend>PDF Reading</legend>
          <p id="pdf-reading-help">
            Content remains visible, selectable, and searchable in all views. This only affects screen reader
            announcements.
          </p>
          <label>
            <input
              type="checkbox"
              checked={pdfPreferences.hideHeadersFooters}
              onChange={(event) => updatePdfPreference('hideHeadersFooters', event.target.checked)}
            />
            Hide running headers/footers from assistive technology
          </label>
          <label>
            <input
              type="checkbox"
              checked={pdfPreferences.hidePageNumbers}
              onChange={(event) => updatePdfPreference('hidePageNumbers', event.target.checked)}
            />
            Hide printed page numbers from assistive technology
          </label>
        </fieldset>
        <p role="status">{pdfConfirmation}</p>
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
              ? recoveryAvailable
                ? 'This vault is password protected and has an optional recovery key. The key can reset this password, but cannot unlock notes protected by separate passwords.'
                : 'This vault is password protected. The password cannot be recovered unless you enable recovery.'
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
          {securityEnabled && onPrepareRecovery && onAcknowledgeRecovery ? (
            <div>
              <h3>Vault recovery</h3>
              {!recoveryKey ? (
                <>
                  <p>
                    {recoveryAvailable
                      ? 'Generate a replacement recovery key. The previous key stops working after you confirm the new key is saved.'
                      : 'Recovery is opt-in. Confirm the current vault password to generate a one-time recovery key.'}
                  </p>
                  <label>
                    Current vault password
                    <input
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      value={recoveryPassword}
                      onChange={(event) => setRecoveryPassword(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={recoveryPassword.length < 8}
                    onClick={() => {
                      void onPrepareRecovery(recoveryPassword)
                        .then(setRecoveryKey)
                        .then(() => setRecoveryPassword(''))
                        .catch(() => setError('Could not prepare recovery. Check the current password and try again.'));
                    }}
                  >
                    {recoveryAvailable ? 'Generate replacement recovery key' : 'Enable vault recovery'}
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Save this recovery key somewhere separate and secure. It is shown only now, is not copied
                    automatically, and cannot recover notes protected by separate passwords.
                  </p>
                  <label>
                    One-time vault recovery key
                    <input
                      ref={recoveryKeyInput}
                      readOnly
                      value={recoveryKey}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={recoverySaved}
                      onChange={(event) => setRecoverySaved(event.target.checked)}
                    />
                    I have saved this recovery key somewhere secure
                  </label>
                  <button
                    type="button"
                    disabled={!recoverySaved}
                    onClick={() => {
                      void onAcknowledgeRecovery()
                        .then(() => {
                          setRecoveryKey('');
                          setRecoverySaved(false);
                          setError('Recovery key saved and enabled.');
                        })
                        .catch(() => setError('Could not enable the recovery key. Keep your saved copy and retry.'));
                    }}
                  >
                    Confirm saved recovery key
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryKey('');
                      setRecoverySaved(false);
                    }}
                  >
                    Discard and generate another key
                  </button>
                </>
              )}
              {recoveryAvailable && onRevokeRecovery ? (
                <>
                  <label>
                    Current vault password to revoke recovery
                    <input
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      value={revokePassword}
                      onChange={(event) => setRevokePassword(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={revokePassword.length < 8}
                    onClick={() => {
                      void onRevokeRecovery(revokePassword)
                        .then(() => {
                          setRevokePassword('');
                          setError('Vault recovery key revoked.');
                        })
                        .catch(() => setError('Could not revoke recovery. Check the current password and try again.'));
                    }}
                  >
                    Revoke recovery key
                  </button>
                </>
              ) : null}
            </div>
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
