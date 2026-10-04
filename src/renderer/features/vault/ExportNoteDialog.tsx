import { useState } from 'react';
import Modal from '../../components/Modal';
import { formatConversionWarning } from './format-conversion';

interface Props {
  path: string;
  content: string;
  sourceFormat: 'markdown' | 'html';
  protectedNote: boolean;
  onExport: (format: 'html' | 'markdown', protectedConsent: boolean) => Promise<void>;
  onClose: () => void;
}

export default function ExportNoteDialog({ path, content, sourceFormat, protectedNote, onExport, onClose }: Props) {
  const [format, setFormat] = useState<'html' | 'markdown'>('html');
  const [protectedConsent, setProtectedConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const warning =
    format === sourceFormat
      ? ''
      : formatConversionWarning(content, sourceFormat, format === 'html' ? 'html' : 'markdown');
  async function exportNote() {
    setBusy(true);
    setError('');
    try {
      await onExport(format, protectedConsent);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export this note.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Export note" titleId="export-note-heading" onClose={() => !busy && onClose()}>
      <div className="modal-body" aria-busy={busy}>
        <p>Export {path}. The original note is not changed.</p>
        <label htmlFor="export-note-format">Export format</label>
        <select
          id="export-note-format"
          value={format}
          disabled={busy}
          onChange={(event) => setFormat(event.target.value as 'html' | 'markdown')}
        >
          <option value="html">Standalone HTML (.html)</option>
          <option value="markdown">Markdown (.md)</option>
        </select>
        {warning && <p>{warning}</p>}
        <p>
          Local raster images are embedded in HTML exports. Relative links and attachments are not copied; review them
          after export. Annotation records are stored separately and are not exported.
        </p>
        {protectedNote && (
          <label>
            <input
              type="checkbox"
              checked={protectedConsent}
              disabled={busy}
              onChange={(event) => setProtectedConsent(event.target.checked)}
            />
            I explicitly consent to exporting this protected note's decrypted content.
          </label>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
        <button type="button" disabled={busy || (protectedNote && !protectedConsent)} onClick={() => void exportNote()}>
          {busy ? 'Exporting…' : 'Choose export location…'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
