import { useEffect, useRef, useState } from 'react';
import type { PdfAnnotation } from '../../../shared/pdf-annotation';

export default function PdfUnavailableNotes({ path, reason }: { path: string; reason: string }) {
  const [notes, setNotes] = useState<PdfAnnotation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const version = ++generation.current;
    setNotes([]);
    void window.a11yNotebook?.vault
      ?.listPdfAnnotations?.(path)
      .then((stored) => {
        if (version === generation.current) setNotes(stored);
      })
      .catch(() => {
        if (version === generation.current) setError('Could not load retained PDF notes.');
      });
    return () => {
      generation.current += 1;
    };
  }, [path]);
  const remove = async (note: PdfAnnotation) => {
    if (busy || !window.a11yNotebook?.vault?.deletePdfAnnotation) return;
    const version = generation.current;
    setBusy(true);
    setError('');
    try {
      await window.a11yNotebook.vault.deletePdfAnnotation(path, note.id);
      if (version !== generation.current) return;
      setNotes((previous) => previous.filter((item) => item.id !== note.id));
      setMessage('Retained PDF note deleted.');
      root.current?.focus();
    } catch {
      if (version === generation.current) setError('Could not delete retained PDF note.');
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  return (
    <section ref={root} tabIndex={-1} aria-label="Unavailable PDF notes" className="pdf-notes">
      <h4>Retained PDF notes</h4>
      <p>PDF note locations are unavailable and no highlights are shown. {reason} Stored notes remain retained.</p>
      <p role="status">{message}</p>
      {error ? <p role="alert">{error}</p> : null}
      {notes.length ? (
        <ul aria-label="Retained PDF notes">
          {notes.map((note) => (
            <li key={note.id}>
              <h5>{note.label || 'PDF note'}</h5>
              <p>Location unavailable. Stored confidence: {note.target.confidence}. Verification: unverified.</p>
              <blockquote className="pdf-note-quote">
                {[note.target, ...(note.targets ?? [])].map((target) => target.exactQuote).join('\n')}
              </blockquote>
              <p>
                {[note.target, ...(note.targets ?? [])]
                  .map((target) => target.reason)
                  .filter(Boolean)
                  .join(' ') || 'The PDF cannot currently be read, so its original quotation cannot be verified.'}
              </p>
              {note.comment ? <p className="pdf-note-comment">{note.comment}</p> : null}
              <button
                type="button"
                disabled={busy || !window.a11yNotebook?.vault?.deletePdfAnnotation}
                onClick={() => void remove(note)}
              >
                Delete {note.label || 'PDF note'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
