import { useEffect, useId, useState } from 'react';
import Modal from '../../components/Modal';
import type { PdfDocument } from '../../pdf-semantic';
import type { PdfSelectionRange } from './pdf-note-selection';

export default function PdfQuoteDialog({
  document,
  loadedPages,
  onChoose,
  onClose,
}: {
  document: PdfDocument;
  loadedPages: number;
  onChoose: (range: PdfSelectionRange) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Array<PdfSelectionRange & { preview: string }>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let cancelled = false;
    setMatches([]);
    setSelected(null);
    if (!query.trim()) {
      setStatus('Enter text to find a quotation.');
      return;
    }
    setStatus('Finding quotation matches…');
    void (async () => {
      const found: Array<PdfSelectionRange & { preview: string }> = [];
      for (let number = 1; number <= loadedPages && found.length < 100; number += 1) {
        const page = await document.getPage(number);
        if (cancelled) return;
        for (const match of page.textModel.findText(query)) {
          found.push({
            page: number,
            start: match.startOffset,
            length: match.length,
            preview: page.textModel.fullText.slice(
              Math.max(0, match.startOffset - 60),
              match.startOffset + match.length + 60,
            ),
          });
          if (found.length === 100) break;
        }
      }
      if (cancelled) return;
      setMatches(found);
      setStatus(
        `${found.length === 100 ? 'First 100' : found.length} matches. Choose the intended occurrence explicitly.`,
      );
    })().catch(() => {
      if (!cancelled) setStatus('Quotation search failed. Please try again.');
    });
    return () => {
      cancelled = true;
    };
  }, [document, loadedPages, query]);
  return (
    <Modal titleId={`${id}-title`} title="Choose PDF quotation" onClose={onClose}>
      <p>
        Search covers the first {loadedPages} loaded pages. This reader displays one page at a time; select across pages
        by creating separate notes.
      </p>
      <label>
        Quotation text
        <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} maxLength={10000} />
      </label>
      <p role="status">{status}</p>
      <fieldset className="pdf-quote-matches">
        <legend>Matching occurrences</legend>
        {matches.map((match, index) => (
          <label key={`${match.page}-${match.start}`}>
            <input type="radio" name={`${id}-match`} checked={selected === index} onChange={() => setSelected(index)} />
            Page {match.page}, occurrence {index + 1}: {match.preview}
          </label>
        ))}
      </fieldset>
      <div className="modal-actions">
        <button
          type="button"
          disabled={selected === null}
          onClick={() => selected !== null && onChoose(matches[selected])}
        >
          Use selected quotation
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
