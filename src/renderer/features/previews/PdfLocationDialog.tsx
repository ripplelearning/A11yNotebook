import { useId, useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';

export default function PdfLocationDialog({
  originalQuote,
  currentQuote,
  onSave,
  onClose,
}: {
  originalQuote: string;
  currentQuote: string;
  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSave();
    } catch {
      setError('Could not save the new PDF note location. Please try again.');
      setSaving(false);
    }
  };
  return (
    <Modal titleId={`${id}-title`} title="Reconfirm PDF note location" onClose={() => !saving && onClose()}>
      <form onSubmit={(event) => void submit(event)}>
        <h3>Original quotation</h3>
        <blockquote className="pdf-note-quote">{originalQuote}</blockquote>
        <h3>Selected current quotation</h3>
        <blockquote className="pdf-note-quote">{currentQuote}</blockquote>
        <p>
          This replaces the location of the existing note. Its label, comment, color, and identifier stay unchanged.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button data-autofocus type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save location'}
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
