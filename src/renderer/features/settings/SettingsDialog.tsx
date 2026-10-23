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
import type { MetadataProtectionStatus, ProtectedStoreName } from '../../../shared/metadata-protection';
import { EXTENDABLE_PROTECTED_STORES } from '../../../shared/metadata-protection';

const EXTENDABLE_STORE_LABELS: Record<string, string> = {
  'reminder-defaults': 'Reminder defaults',
  milestones: 'Milestones',
  bookmarks: 'Bookmarks',
  links: 'Link index',
  'image-alts': 'Image descriptions',
  'flashcard-schedules': 'Flashcard schedules',
  reminders: 'Reminders',
  settings: 'Settings',
  'search-index': 'Search index',
};
import { playReminderSound, stopReminderSound } from '../reminders/reminderSound';
import { useShortcutCapture } from './useShortcutCapture';

interface Props {
  settings: NotebookSettings;
  onSave: (settings: NotebookSettings) => Promise<void>;
  onClose: () => void;
  onShortcutCaptureChange?: (active: boolean) => void;
  securityEnabled?: boolean;
  recoveryAvailable?: boolean;
  onSetVaultPassword?: (password: string) => Promise<void>;
  onPrepareRecovery?: (password: string) => Promise<string>;
  onAcknowledgeRecovery?: (acknowledged: boolean) => Promise<void>;
  onRevokeRecovery?: (password: string) => Promise<void>;
  onRotateDataKey?: (password: string, recoveryKey: string | null) => Promise<void>;
  onLockVault?: () => Promise<void>;
  onSaveCredential?: (id: string, username: string, password: string) => Promise<void>;
  onDeleteCredential?: (id: string) => Promise<void>;
}

export default function SettingsDialog({
  settings,
  onSave,
  onClose,
  onShortcutCaptureChange,
  securityEnabled = false,
  recoveryAvailable = false,
  onSetVaultPassword,
  onPrepareRecovery,
  onAcknowledgeRecovery,
  onRevokeRecovery,
  onRotateDataKey,
  onLockVault,
  onSaveCredential,
  onDeleteCredential,
}: Props) {
  const [draft, setDraft] = useState(settings);
  const capture = useShortcutCapture(
    draft.shortcuts,
    (id, shortcut) =>
      setDraft((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, [id]: shortcut },
      })),
    onShortcutCaptureChange,
  );
  const [error, setError] = useState('');
  const [securityNotice, setSecurityNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryPreparing, setRecoveryPreparing] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [revokePassword, setRevokePassword] = useState('');
  const [rotatePassword, setRotatePassword] = useState('');
  const [rotateRecoveryKey, setRotateRecoveryKey] = useState('');
  const [rotating, setRotating] = useState(false);
  const recoveryKeyInput = useRef<HTMLInputElement>(null);
  const [credentials, setCredentials] = useState<{ id: string; username: string; password: string }[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  const pdfPreferences = usePdfReadingPreferences();
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [pdfConfirmation, setPdfConfirmation] = useState('');
  const [soundNotice, setSoundNotice] = useState('');
  const [metadataProtection, setMetadataProtection] = useState<MetadataProtectionStatus>();
  const [libraryEncryption, setLibraryEncryption] = useState<{
    enabled: boolean;
    state: 'migrating' | 'active' | 'decrypting' | null;
    files: number;
  }>();
  const [libraryDecryptionConsent, setLibraryDecryptionConsent] = useState(false);
  const [libraryDecryptionSaving, setLibraryDecryptionSaving] = useState(false);
  const [libraryEncryptionConsent, setLibraryEncryptionConsent] = useState(false);
  const [libraryEncryptionSaving, setLibraryEncryptionSaving] = useState(false);
  const [metadataConsent, setMetadataConsent] = useState(false);
  const [extendConsent, setExtendConsent] = useState<Partial<Record<ProtectedStoreName, boolean>>>({});
  const [metadataSaving, setMetadataSaving] = useState(false);
  const metadataGeneration = useRef(0);
  useEffect(() => {
    const generation = ++metadataGeneration.current;
    const load = window.a11yNotebook?.vault.getMetadataProtectionStatus;
    if (load) {
      void load()
        .then((value) => {
          if (metadataGeneration.current === generation) setMetadataProtection(value);
        })
        .catch(() => {
          if (metadataGeneration.current === generation) setError('Could not load metadata protection status.');
        });
    }
    return () => {
      metadataGeneration.current += 1;
    };
  }, [securityEnabled, recoveryAvailable]);
  useEffect(() => {
    const load = window.a11yNotebook?.vault.libraryEncryptionStatus;
    if (load) {
      void load()
        .then(setLibraryEncryption)
        .catch(() => undefined);
    }
  }, [securityEnabled]);
  useEffect(() => stopReminderSound, []);
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
    <Modal
      title="Settings"
      titleId="settings-heading"
      onClose={() => {
        capture.stop();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          capture.stop();
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
        <h3>General editing and autosave</h3>
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
          Default note open mode
          <select
            value={draft.defaultNoteOpenMode ?? 'read-only'}
            onChange={(event) =>
              setDraft({
                ...draft,
                defaultNoteOpenMode: event.target.value as NotebookSettings['defaultNoteOpenMode'],
              })
            }
          >
            <option value="read-only">Read mode</option>
            <option value="edit">Edit mode</option>
          </select>
        </label>
        <p>This applies to managed notes. Read-only documents remain read-only, and editing locks still apply.</p>
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
        <h3>Appearance and interface</h3>
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
          <input
            type="checkbox"
            checked={draft.showCommandButtons ?? false}
            onChange={(event) => setDraft({ ...draft, showCommandButtons: event.target.checked })}
          />
          Show command/action buttons in the UI
        </label>
        <p>
          The default is the menu-first interface. The native menu stays available in both modes. Browser development
          keeps command buttons available.
        </p>
        <fieldset>
          <legend>
            <h3>Reminder alerts</h3>
          </legend>
          <label>
            <input
              type="checkbox"
              checked={draft.reminderAlerts ?? false}
              onChange={(event) => setDraft({ ...draft, reminderAlerts: event.target.checked })}
            />
            Enable in-app reminder alerts
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.reminderSound ?? false}
              onChange={(event) => setDraft({ ...draft, reminderSound: event.target.checked })}
            />
            Enable reminder sound
          </label>
          <label>
            Reminder sound
            <select
              value={draft.reminderSoundChoice ?? 'gentle-chime'}
              onChange={() => setDraft({ ...draft, reminderSoundChoice: 'gentle-chime' })}
            >
              <option value="gentle-chime">Gentle chime</option>
            </select>
          </label>
          <label>
            Reminder volume (percent)
            <input
              type="range"
              min={0}
              max={100}
              value={draft.reminderVolume ?? 50}
              onChange={(event) => setDraft({ ...draft, reminderVolume: Number(event.target.value) })}
            />
            <output>{draft.reminderVolume ?? 50}%</output>
          </label>
          <button
            type="button"
            onClick={() => {
              void playReminderSound({ ...DEFAULT_SETTINGS, reminderVolume: draft.reminderVolume ?? 50 })
                .then(() => setSoundNotice('Test sound played.'))
                .catch(() => setError('Could not play test sound.'));
            }}
          >
            Test sound
          </button>
          <p>
            Sound and in-app alerts are independent of native notification consent. Background alerts wait for window
            focus.
          </p>
          <label>
            <input
              type="checkbox"
              checked={draft.backgroundReminders ?? false}
              onChange={(event) => setDraft({ ...draft, backgroundReminders: event.target.checked })}
            />
            Alert me after the app closes (Windows only)
          </label>
          <p>
            When this is on, Windows Task Scheduler briefly launches the app at each due time to show a generic alert,
            even after you close the app. The scheduled task and the small snapshot it reads contain only due times —
            never reminder titles or note content — and alerts stay generic until you unlock the library. Turning this
            off deletes the scheduled task.
          </p>
          <p role="status">{soundNotice}</p>
        </fieldset>
        <fieldset aria-describedby="pdf-reading-help" disabled={pdfLoading || pdfSaving}>
          <legend>
            <h3>PDF Reading</h3>
          </legend>
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
          <legend>
            <h3>Keyboard Shortcuts</h3>
          </legend>
          <p>
            Enter a shortcut manually or use Capture Shortcut. Leave it empty to disable it. Pane and tab navigation
            keys are reserved. Escape or Tab cancels capture. Operating-system shortcuts may not reach this app.
          </p>
          <p role="status" aria-live="polite">
            {capture.notice}
          </p>
          {COMMANDS.map((command) => (
            <div key={command.id} className="settings-shortcut-row">
              <label htmlFor={`shortcut-${command.id}`}>{command.label}</label>
              <input
                id={`shortcut-${command.id}`}
                value={draft.shortcuts[command.id] ?? command.shortcut ?? ''}
                onFocus={() => {
                  if (capture.capturing) capture.stop();
                }}
                onChange={(event) =>
                  setDraft({ ...draft, shortcuts: { ...draft.shortcuts, [command.id]: event.target.value } })
                }
              />
              <button
                id={`capture-${command.id}`}
                type="button"
                aria-label={`Capture Shortcut for ${command.label}`}
                aria-pressed={capture.capturing === command.id}
                onClick={() => capture.start(command.id)}
              >
                Capture Shortcut
              </button>
            </div>
          ))}
          {capture.capturing && (
            <button type="button" onClick={capture.cancel}>
              Cancel capture
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              capture.stop();
              setDraft({ ...draft, shortcuts: {} });
            }}
          >
            Reset shortcuts to defaults
          </button>
        </fieldset>
        <fieldset>
          <legend>
            <h3>Library security</h3>
          </legend>
          <label>
            Library idle lock in minutes (0 disables; maximum 240)
            <input
              type="number"
              min={0}
              max={240}
              value={draft.vaultLockMinutes ?? 15}
              onChange={(event) => setDraft({ ...draft, vaultLockMinutes: Number(event.target.value) })}
            />
          </label>
          <p>
            {securityEnabled
              ? recoveryAvailable
                ? 'This library is password protected and has an optional recovery key. The key can reset this password, but cannot unlock notes protected by separate passwords.'
                : 'This library is password protected. The password cannot be recovered unless you enable recovery.'
              : 'Set a password to require authentication when opening this library. This does not encrypt unmarked notes.'}
          </p>
          {!securityEnabled && onSetVaultPassword ? (
            <>
              <label>
                New library password (at least 8 characters)
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1024}
                  value={vaultPassword}
                  onChange={(event) => setVaultPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm library password
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
                      setError('Library password protection enabled.');
                    })
                    .catch(() => setError('Could not enable library password protection.'));
                }}
              >
                Set library password
              </button>
            </>
          ) : null}
          {securityEnabled && onLockVault ? (
            <button type="button" onClick={() => void onLockVault().catch(() => setError('Could not lock library.'))}>
              Lock library now
            </button>
          ) : null}
          {securityEnabled && onPrepareRecovery && onAcknowledgeRecovery ? (
            <div>
              <h4>Library recovery</h4>
              {!recoveryKey ? (
                <>
                  <p>
                    {recoveryAvailable
                      ? 'Generate a replacement recovery key. The previous key stops working after you confirm the new key is saved.'
                      : 'Recovery is opt-in. Confirm the current library password to generate a one-time recovery key.'}
                  </p>
                  <label>
                    Current library password
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
                    disabled={recoveryPreparing || recoveryPassword.length < 8}
                    onClick={() => {
                      setRecoveryPreparing(true);
                      setRecoverySaved(false);
                      void onPrepareRecovery(recoveryPassword)
                        .then(setRecoveryKey)
                        .then(() => setRecoveryPassword(''))
                        .catch(() => setError('Could not prepare recovery. Check the current password and try again.'))
                        .finally(() => setRecoveryPreparing(false));
                    }}
                  >
                    {recoveryAvailable ? 'Generate replacement recovery key' : 'Enable library recovery'}
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Save this recovery key somewhere separate and secure. It is shown only now, is not copied
                    automatically, and cannot recover notes protected by separate passwords.
                  </p>
                  <label>
                    One-time library recovery key
                    <input ref={recoveryKeyInput} readOnly value={recoveryKey} spellCheck={false} autoComplete="off" />
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
                      void onAcknowledgeRecovery(true)
                        .then(() => {
                          setRecoveryKey('');
                          setRecoverySaved(false);
                          setSecurityNotice('Recovery key saved and enabled.');
                        })
                        .catch(() => setError('Could not enable the recovery key. Keep your saved copy and retry.'));
                    }}
                  >
                    Confirm saved recovery key
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onAcknowledgeRecovery(false)
                        .then(() => {
                          setRecoveryKey('');
                          setRecoverySaved(false);
                        })
                        .catch(() => setError('Could not discard the pending recovery key.'));
                    }}
                  >
                    Discard and generate another key
                  </button>
                </>
              )}
              {onRotateDataKey && !recoveryKey ? (
                <>
                  <h4>Data key rotation</h4>
                  <p>
                    Rotation replaces the library's underlying encryption key and re-encrypts protected metadata,
                    the credentials store, and library-encrypted notes under the new key. Your password stays the
                    same{recoveryAvailable ? ' and your existing recovery key stays valid' : ''}. Enter your current
                    password{recoveryAvailable ? ' and your recovery key' : ''} to confirm. Notes protected by
                    separate passwords are not affected.
                  </p>
                  <label>
                    Current library password to rotate the data key
                    <input
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      value={rotatePassword}
                      onChange={(event) => setRotatePassword(event.target.value)}
                    />
                  </label>
                  {recoveryAvailable ? (
                    <label>
                      Current recovery key
                      <input
                        type="password"
                        autoComplete="off"
                        maxLength={1024}
                        value={rotateRecoveryKey}
                        onChange={(event) => setRotateRecoveryKey(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      rotating ||
                      rotatePassword.length < 8 ||
                      (recoveryAvailable && rotateRecoveryKey.trim().length === 0)
                    }
                    onClick={() => {
                      setRotating(true);
                      void onRotateDataKey(rotatePassword, recoveryAvailable ? rotateRecoveryKey.trim() : null)
                        .then(() => {
                          setRotatePassword('');
                          setRotateRecoveryKey('');
                          setSecurityNotice('Data key rotated. Everything now encrypts under the new key.');
                        })
                        .catch(() =>
                          setError('Could not rotate the data key. Check the password and recovery key and try again.'),
                        )
                        .finally(() => setRotating(false));
                    }}
                  >
                    {rotating ? 'Rotating data key…' : 'Rotate data key'}
                  </button>
                </>
              ) : null}
              {recoveryAvailable && onRevokeRecovery && !recoveryKey ? (
                <>
                  <label>
                    Current library password to revoke recovery
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
                          setSecurityNotice('Library recovery key revoked.');
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
              <h4>Encrypted service credentials</h4>
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
        {metadataProtection ? (
          <fieldset disabled={metadataSaving}>
            <legend>
              <h3>Scoped metadata encryption</h3>
            </legend>
            <p>
              This is not whole-library encryption. It encrypts Markdown, HTML, PDF, DOCX and ePub annotations and recovery drafts
              for outlines, mindmaps, grids and flashcards. Ordinary notes,
              attachments, saved cognitive asset files (including saved flashcards), filenames,
              global preferences and the audit log remain plaintext. The app-global
              fallback copy of settings also remains plaintext; it stops being updated while a library whose
              settings are encrypted is open, and enabling settings encryption removes the stale copy. Reminders, reminder defaults,
              milestones, bookmarks, the link index, image descriptions, flashcard schedules, library settings and the search index can each be migrated into encryption below once the base protection is on. Notes, source
              attachments, exports and backups remain plaintext, not whole-library encrypted. Flashcard drafts are
              encrypted, but their saved source files remain plaintext. Unlocked application memory is not protected.
              Plaintext cleanup is not secure erasure. A stable version 3 library recovery envelope is required.
            </p>
            {metadataProtection.enabled ? (
              <>
                <p role="status">
                  {metadataProtection.cleanupRequired
                    ? 'Metadata encryption is enabled, but plaintext cleanup must finish. Reopen and unlock the library to retry.'
                    : `Encrypted at rest: ${metadataProtection.protectedStores
                        .map((store) => EXTENDABLE_STORE_LABELS[store] ?? store)
                        .join(', ')}.`}
                </p>
                {EXTENDABLE_PROTECTED_STORES.filter(
                  (store) => !metadataProtection.protectedStores.includes(store),
                ).map((store) => (
                  <div key={store}>
                    <label>
                      <input
                        type="checkbox"
                        checked={extendConsent[store] ?? false}
                        disabled={!metadataProtection.eligible || metadataProtection.locked}
                        onChange={(event) =>
                          setExtendConsent((current) => ({ ...current, [store]: event.target.checked }))
                        }
                      />
                      I consent to encrypting {EXTENDABLE_STORE_LABELS[store] ?? store}; I understand everything else
                      listed above remains plaintext, not whole-library encrypted
                    </label>
                    <button
                      type="button"
                      disabled={
                        !extendConsent[store] || !metadataProtection.eligible || metadataProtection.locked
                      }
                      onClick={() => {
                        const extend = window.a11yNotebook?.vault.extendMetadataProtection;
                        if (!extend) {
                          setError('Metadata encryption is unavailable.');
                          return;
                        }
                        const generation = metadataGeneration.current;
                        setMetadataSaving(true);
                        void extend({ store, acknowledgeExclusions: true })
                          .then((value) => {
                            if (metadataGeneration.current !== generation) return;
                            setMetadataProtection(value);
                            setExtendConsent((current) => ({ ...current, [store]: false }));
                            setSecurityNotice(`${EXTENDABLE_STORE_LABELS[store] ?? store} are now encrypted at rest.`);
                          })
                          .catch(() => {
                            if (metadataGeneration.current === generation)
                              setError('Could not extend metadata encryption. No success is assumed; check status and retry.');
                          })
                          .finally(() => {
                            if (metadataGeneration.current === generation) setMetadataSaving(false);
                          });
                      }}
                    >
                      {metadataSaving ? 'Encrypting…' : `Encrypt ${EXTENDABLE_STORE_LABELS[store] ?? store}`}
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                <p>
                  {metadataProtection.eligible && !metadataProtection.locked
                    ? 'Enabling this protection migrates existing annotations and enables new encrypted checkpoints. It is opt-in.'
                    : 'First enable recovery and unlock a version-3 library to enable scoped metadata encryption.'}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={metadataConsent}
                    disabled={!metadataProtection.eligible || metadataProtection.locked}
                    onChange={(event) => setMetadataConsent(event.target.checked)}
                  />
                  I consent to encrypting only Markdown, HTML and PDF annotations and outline, mindmap, grid and
                  flashcard recovery drafts; I understand the listed data remains plaintext, not whole-library encrypted
                </label>
                <button
                  type="button"
                  disabled={!metadataConsent || !metadataProtection.eligible || metadataProtection.locked}
                  onClick={() => {
                    const enable = window.a11yNotebook?.vault.enableMetadataProtection;
                    if (!enable) {
                      setError('Metadata encryption is unavailable.');
                      return;
                    }
                    const generation = metadataGeneration.current;
                    setMetadataSaving(true);
                    void enable({ acknowledgeExclusions: true })
                      .then((value) => {
                        if (metadataGeneration.current !== generation) return;
                        setMetadataProtection(value);
                        setMetadataConsent(false);
                        setSecurityNotice('Scoped metadata encryption enabled.');
                      })
                      .catch(() => {
                        if (metadataGeneration.current === generation)
                          setError(
                            'Could not enable metadata encryption. No success is assumed; check status and retry.',
                          );
                      })
                      .finally(() => {
                        if (metadataGeneration.current === generation) setMetadataSaving(false);
                      });
                  }}
                >
                  {metadataSaving ? 'Enabling metadata encryption…' : 'Enable scoped metadata encryption'}
                </button>
              </>
            )}
          </fieldset>
        ) : null}
        {securityEnabled && libraryEncryption ? (
          <fieldset>
            <legend>
              <h3>Whole-library encryption</h3>
            </legend>
            {libraryEncryption.enabled ? (
              <>
                <p>
                  Whole-library encryption is{' '}
                  {libraryEncryption.state === 'active'
                    ? 'on'
                    : libraryEncryption.state === 'decrypting'
                      ? 'being turned off — decryption will finish next time you unlock'
                      : 'still migrating'}{' '}
                  for this library: {libraryEncryption.files} note file{libraryEncryption.files === 1 ? '' : 's'}{' '}
                  encrypted at rest. Notes open only while the library is unlocked. Attachments are not covered yet
                  and remain ordinary files.
                </p>
                {libraryEncryption.state === 'active' ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={libraryDecryptionConsent}
                        onChange={(event) => setLibraryDecryptionConsent(event.target.checked)}
                      />
                      I understand my notes will be decrypted back into ordinary files that any app can read
                    </label>
                    <button
                      type="button"
                      disabled={!libraryDecryptionConsent || libraryDecryptionSaving}
                      onClick={() => {
                        const disable = window.a11yNotebook?.vault.disableLibraryEncryption;
                        if (!disable) return;
                        setLibraryDecryptionSaving(true);
                        void disable(true)
                          .then(() => {
                            setLibraryDecryptionConsent(false);
                            setSecurityNotice('Whole-library encryption is off. Your notes are ordinary files again.');
                            setLibraryEncryption({ enabled: false, state: null, files: 0 });
                          })
                          .catch(() =>
                            setError('Could not turn off whole-library encryption. Unlock the library and try again.'),
                          )
                          .finally(() => setLibraryDecryptionSaving(false));
                      }}
                    >
                      {libraryDecryptionSaving ? 'Decrypting notes…' : 'Decrypt all notes and turn off'}
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p>
                  Whole-library encryption stores every note file in this library as an authenticated encrypted
                  container, readable only while the library is unlocked. It is separate from metadata encryption
                  above. Notes can no longer be read by other apps or editors, search works only while unlocked, and
                  if you lose both the password and the recovery key the notes are unrecoverable. Attachments are
                  not covered yet and remain ordinary files. Migration runs now and resumes automatically after an
                  interruption.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={libraryEncryptionConsent}
                    onChange={(event) => setLibraryEncryptionConsent(event.target.checked)}
                  />
                  I understand my note files will be encrypted at rest and only open inside this app while unlocked
                </label>
                <button
                  type="button"
                  disabled={!libraryEncryptionConsent || libraryEncryptionSaving}
                  onClick={() => {
                    const enable = window.a11yNotebook?.vault.enableLibraryEncryption;
                    if (!enable) return;
                    setLibraryEncryptionSaving(true);
                    void enable(true)
                      .then(() => {
                        setLibraryEncryptionConsent(false);
                        setSecurityNotice('Whole-library encryption is on. Your notes are encrypted at rest.');
                        return window.a11yNotebook?.vault.libraryEncryptionStatus?.();
                      })
                      .then((status) => {
                        if (status) setLibraryEncryption(status);
                      })
                      .catch(() =>
                        setError('Could not enable whole-library encryption. Unlock the library and try again.'),
                      )
                      .finally(() => setLibraryEncryptionSaving(false));
                  }}
                >
                  {libraryEncryptionSaving ? 'Encrypting notes…' : 'Encrypt all notes in this library'}
                </button>
              </>
            )}
          </fieldset>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {securityNotice ? <p role="status">{securityNotice}</p> : null}
        <button type="submit" disabled={saving}>
          Save settings
        </button>
        <button
          type="button"
          onClick={() => {
            capture.stop();
            setDraft(DEFAULT_SETTINGS);
          }}
        >
          Reset all settings
        </button>
        <button
          type="button"
          onClick={() => {
            capture.stop();
            onClose();
          }}
        >
          Cancel
        </button>
      </form>
    </Modal>
  );
}
