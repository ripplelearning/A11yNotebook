import { useId, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import type { PdfAnnotation } from '../../../shared/pdf-annotation';

export interface PdfNoteValues {
  label: string;
  comment: string;
  color: PdfAnnotation['color'];
}

export default function PdfNoteDialog({
  quote,
  onSave,
  onClose,
}: {
  quote: string;
  onSave: (values: PdfNoteValues) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState('');
  const [color, setColor] = useState<PdfAnnotation['color']>('yellow');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!label.trim() && !comment.trim()) {
      setError('Enter a label or comment before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ label: label.trim(), comment: comment.trim(), color });
    } catch {
      setError('Could not save this PDF note. Please try again.');
      setSaving(false);
    }
  };
  return (
    <Modal titleId={`${id}-title`} title="Create PDF note" onClose={() => !saving && onClose()}>
      <form
        onSubmit={(event) => void save(event)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            !(event.target instanceof HTMLTextAreaElement) &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <blockquote className="pdf-note-quote">{quote}</blockquote>
        <p id={`${id}-help`}>Label and comment are optional individually. Enter at least one.</p>
        <label>
          Label (optional)
          <input
            data-autofocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-describedby={`${id}-help`}
            disabled={saving}
            maxLength={100}
          />
        </label>
        <label>
          Comment (optional)
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={saving}
            rows={4}
            maxLength={10000}
          />
        </label>
        <fieldset disabled={saving}>
          <legend>Highlight color</legend>
          {(['red', 'yellow', 'green', 'blue', 'none'] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={`${id}-color`}
                value={option}
                checked={color === option}
                onChange={() => setColor(option)}
              />
              {option === 'none' ? 'None (outline only)' : option[0].toUpperCase() + option.slice(1)}
            </label>
          ))}
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
