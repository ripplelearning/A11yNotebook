import { useState } from 'react';
import { COMMANDS } from '../../../shared/command-registry';
import { DEFAULT_SETTINGS, validateSettings, type NotebookSettings } from '../../../shared/settings';
import Modal from '../../components/Modal';

interface Props {
  settings: NotebookSettings;
  onSave: (settings: NotebookSettings) => Promise<void>;
  onClose: () => void;
}

export default function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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
