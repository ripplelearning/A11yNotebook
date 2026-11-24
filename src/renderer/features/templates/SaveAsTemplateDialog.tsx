import { useId, useState } from 'react';
import Modal from '../../components/Modal';
import { validateNoteTitle } from '../../../shared/templates';

export interface SaveAsTemplateResult {
  name: string;
  action: 'copy' | 'discard';
  replace: boolean;
}

export interface SaveAsTemplateDialogProps {
  /** Prefilled with the open note's title. */
  initialName: string;
  /** Names of the templates already in the Templates folder. */
  existingNames: string[];
  onSave: (result: SaveAsTemplateResult) => Promise<void>;
  onClose: () => void;
}

export default function SaveAsTemplateDialog({
  initialName,
  existingNames,
  onSave,
  onClose,
}: SaveAsTemplateDialogProps) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [action, setAction] = useState<'copy' | 'discard'>('copy');
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const validationError = validateNoteTitle(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    const trimmed = name.trim();
    if (!confirmingReplace && existingNames.some((item) => item.trim().toLowerCase() === trimmed.toLowerCase())) {
      setConfirmingReplace(true);
      setError('');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({ name: trimmed, action, replace: confirmingReplace });
      onClose();
    } catch (cause) {
      setConfirmingReplace(false);
      setError(cause instanceof Error ? cause.message : 'Could not save the template.');
      setSaving(false);
    }
  }

  return (
    <Modal titleId={`${id}-title`} title="Save note as template" onClose={() => !saving && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void submit();
        }}
        aria-busy={saving}
      >
        <div className="modal-body">
          <label htmlFor={`${id}-name`}>Template name</label>
          <input
            id={`${id}-name`}
            data-autofocus
            value={name}
            maxLength={200}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error)}
            disabled={saving}
            onChange={(event) => {
              setName(event.target.value);
              setConfirmingReplace(false);
            }}
          />
          <fieldset>
            <legend>Original note</legend>
            <label>
              <input
                type="radio"
                name={`${id}-action`}
                value="copy"
                checked={action === 'copy'}
                disabled={saving}
                onChange={() => setAction('copy')}
              />
              Keep the original note
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-action`}
                value="discard"
                checked={action === 'discard'}
                disabled={saving}
                onChange={() => setAction('discard')}
              />
              Discard the original note
            </label>
          </fieldset>
          {confirmingReplace ? (
            <p id={`${id}-error`} role="alert">
              A template named “{name.trim()}” already exists. Replace it?
            </p>
          ) : (
            error && (
              <p id={`${id}-error`} role="alert">
                {error}
              </p>
            )
          )}
        </div>
        <div className="modal-actions">
          {confirmingReplace ? (
            <>
              <button type="submit" disabled={saving}>
                {saving ? 'Replacing…' : 'Replace template'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingReplace(false);
                  setError('');
                }}
                disabled={saving}
              >
                Choose a different name
              </button>
            </>
          ) : (
            <>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save as template'}
              </button>
              <button type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
