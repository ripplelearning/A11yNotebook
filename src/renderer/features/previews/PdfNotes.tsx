import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfAnnotation, PdfAnnotationTarget } from '../../../shared/pdf-annotation';
import type { PdfDocument, PdfPage } from '../../pdf-semantic';
import PdfNoteDialog, { type PdfNoteValues } from './PdfNoteDialog';
import PdfQuoteDialog from './PdfQuoteDialog';
import { groupedPdfSelection, pdfNoteRectangles, semanticPdfRange, type PdfSelectionRange } from './pdf-note-selection';

type Resolution = Awaited<ReturnType<PdfDocument['resolveAnnotationAnchor']>>;
type ResolvedNote = { note: PdfAnnotation; resolutions: Resolution[] };
let activePdfReader: HTMLElement | null = null;
type PdfCommandDetail = { path?: string; range?: Range; element?: HTMLElement };
function isLocated(resolution: Resolution): resolution is Extract<Resolution, { offset: number }> {
  return 'offset' in resolution && resolution.offset >= 0 && resolution.classification !== 'ambiguous';
}

export interface PdfRenderedPage {
  page: PdfPage;
  scale: number;
  rotation: number;
}

export default function PdfNotes({
  document: pdf,
  path,
  loadedPages,
  readerRef,
  visualRef,
  semanticRef,
  rendered,
  onNavigate,
}: {
  document: PdfDocument;
  path: string;
  loadedPages: number;
  readerRef: RefObject<HTMLElement>;
  visualRef: RefObject<HTMLDivElement>;
  semanticRef: RefObject<HTMLDivElement>;
  rendered: PdfRenderedPage | null;
  onNavigate: (page: number, offset: number, length: number) => void;
}) {
  const [notes, setNotes] = useState<ResolvedNote[]>([]);
  const [targets, setTargets] = useState<PdfAnnotationTarget[] | null>(null);
  const [quoteDialog, setQuoteDialog] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const createButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const operation = useRef(false);
  const currentSemantic = useRef<Element | null>(null);
  const selectedRange = useRef<Range | null>(null);
  useEffect(() => {
    const reader = readerRef.current;
    return () => {
      if (activePdfReader === reader) activePdfReader = null;
    };
  }, [readerRef]);
  const resolveNote = async (note: PdfAnnotation): Promise<ResolvedNote> => ({
    note,
    resolutions: await Promise.all(
      [note.target, ...(note.targets ?? [])].map((target) => pdf.resolveAnnotationAnchor(target)),
    ),
  });

  useEffect(() => {
    const version = ++generation.current;
    setNotes([]);
    setNotesLoaded(false);
    void window.a11yNotebook?.vault
      .listPdfAnnotations(path)
      .then(async (stored) =>
        version !== generation.current
          ? []
          : Promise.all(
              stored.map(async (note) => ({
                note,
                resolutions: await Promise.all(
                  [note.target, ...(note.targets ?? [])].map((target) => pdf.resolveAnnotationAnchor(target)),
                ),
              })),
            ),
      )
      .then((resolved) => {
        if (version === generation.current) {
          setNotes(resolved);
          setNotesLoaded(true);
        }
      })
      .catch(() => {
        if (version === generation.current) {
          setError('Could not load PDF notes.');
          setNotesLoaded(true);
        }
      });
    return () => {
      generation.current += 1;
    };
  }, [pdf, path]);

  useEffect(() => {
    if (!focusNote || targets) return;
    (controls.current.get(focusNote) ?? createButton.current)?.focus();
    setFocusNote(null);
  }, [focusNote, targets, notes]);

  const begin = async (ranges: PdfSelectionRange[]) => {
    const version = generation.current;
    setError('');
    try {
      const anchors = await Promise.all(
        ranges.map(async (range) => (await pdf.getPage(range.page)).createAnnotationAnchor(range.start, range.length)),
      );
      if (version === generation.current) {
        setQuoteDialog(false);
        setTargets(anchors);
      }
    } catch {
      if (version === generation.current) setError('This selection cannot be annotated. Choose a shorter quotation.');
    }
  };
  const createSelection = (range?: Range) => {
    if (!notesLoaded || !rendered || !visualRef.current || !semanticRef.current) return;
    const visualRanges = groupedPdfSelection(range ?? window.getSelection(), [
      { page: rendered.page.pageNum, element: visualRef.current },
    ]);
    const ranges = visualRanges.length
      ? visualRanges
      : groupedPdfSelection(range ?? window.getSelection(), [
          { page: rendered.page.pageNum, element: semanticRef.current },
        ]);
    if (ranges.length) void begin(ranges);
    else setQuoteDialog(true);
  };

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    const remember = (event: FocusEvent) => {
      activePdfReader = reader;
      if (event.target instanceof Element && semanticRef.current?.contains(event.target))
        currentSemantic.current = event.target;
    };
    const rememberSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (reader.contains(range.startContainer) && reader.contains(range.endContainer)) {
        selectedRange.current = range.cloneRange();
        activePdfReader = reader;
      }
    };
    const ownsEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as PdfCommandDetail | undefined) : undefined;
      if (detail?.path) return detail.path === path;
      if (detail?.element) return reader.contains(detail.element);
      if (detail?.range)
        return reader.contains(detail.range.startContainer) && reader.contains(detail.range.endContainer);
      const focusedReader = window.document.activeElement?.closest('[data-context="pdf-selection"]');
      if (focusedReader && focusedReader !== reader) return false;
      return (
        reader.contains(window.document.activeElement) ||
        activePdfReader === reader ||
        Boolean(window.getSelection()?.anchorNode && reader.contains(window.getSelection()!.anchorNode))
      );
    };
    const selection = (event: Event) => {
      if (event.defaultPrevented || !ownsEvent(event) || targets || quoteDialog) return;
      const detail = event instanceof CustomEvent ? (event.detail as PdfCommandDetail | undefined) : undefined;
      const current = window.getSelection();
      createSelection(
        detail?.range ??
          (current && !current.isCollapsed && current.rangeCount
            ? current.getRangeAt(0)
            : (selectedRange.current ?? undefined)),
      );
    };
    const semantic = (event: Event) => {
      if (
        event.defaultPrevented ||
        !ownsEvent(event) ||
        !notesLoaded ||
        targets ||
        quoteDialog ||
        !rendered ||
        !semanticRef.current
      )
        return;
      const detail = event instanceof CustomEvent ? (event.detail as PdfCommandDetail | undefined) : undefined;
      const range = semanticPdfRange(
        detail?.element ??
          (semanticRef.current.contains(window.document.activeElement)
            ? window.document.activeElement
            : currentSemantic.current),
        semanticRef.current,
        rendered.page.pageNum,
      );
      if (range) void begin([range]);
      else setError('Focus a paragraph, heading, or table cell in the accessible page text first.');
    };
    reader.addEventListener('focusin', remember);
    window.document.addEventListener('selectionchange', rememberSelection);
    window.addEventListener('annotate-pdf-selection', selection);
    window.addEventListener('annotate-current-semantic-element', semantic);
    return () => {
      reader.removeEventListener('focusin', remember);
      window.document.removeEventListener('selectionchange', rememberSelection);
      window.removeEventListener('annotate-pdf-selection', selection);
      window.removeEventListener('annotate-current-semantic-element', semantic);
    };
  });

  useEffect(() => {
    if (!rendered || !visualRef.current) return;
    const overlay = window.document.createElement('div');
    overlay.className = 'pdf-note-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    for (const { note, resolutions } of notes) {
      for (const [index, resolution] of resolutions.entries()) {
        if (
          !isLocated(resolution) ||
          resolution.verification !== 'verified' ||
          resolution.page !== rendered.page.pageNum
        )
          continue;
        const target = [note.target, ...(note.targets ?? [])][index];
        for (const [left, top, width, height] of pdfNoteRectangles(
          rendered.page,
          resolution.offset,
          resolution.length ?? target.canonicalLength,
          rendered.scale,
          rendered.rotation,
        )) {
          const mark = window.document.createElement('div');
          mark.className = `pdf-note-highlight pdf-note-color-${note.color}`;
          mark.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
          overlay.append(mark);
        }
      }
    }
    visualRef.current.append(overlay);
    return () => {
      overlay.remove();
    };
  }, [notes, rendered, visualRef]);

  const save = async (values: PdfNoteValues) => {
    if (!targets || operation.current) return;
    operation.current = true;
    const version = generation.current;
    setError('');
    try {
      const note = await window.a11yNotebook!.vault.addPdfAnnotation({
        path,
        target: targets[0],
        ...(targets.length > 1 ? { targets: targets.slice(1) } : {}),
        ...values,
      });
      if (version !== generation.current) return;
      const resolved = await resolveNote(note);
      if (version !== generation.current) return;
      setNotes((previous) => [...previous, resolved]);
      setTargets(null);
      setMessage('PDF note saved.');
      setFocusNote(note.id);
    } finally {
      operation.current = false;
    }
  };
  const remove = async (note: PdfAnnotation) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    const version = generation.current;
    try {
      await window.a11yNotebook!.vault.deletePdfAnnotation(path, note.id);
      if (version !== generation.current) return;
      setNotes((previous) => previous.filter((item) => item.note.id !== note.id));
      setMessage('PDF note deleted.');
      setFocusNote(notes.find((item) => item.note.id !== note.id)?.note.id ?? 'create-note');
    } catch {
      if (version === generation.current) setError('Could not delete PDF note.');
    } finally {
      operation.current = false;
      if (version === generation.current) setBusy(false);
    }
  };
  const verify = async ({ note, resolutions }: ResolvedNote) => {
    if (operation.current || resolutions.some((resolution) => !isLocated(resolution))) return;
    operation.current = true;
    setBusy(true);
    setError('');
    const version = generation.current;
    try {
      const anchors = await Promise.all(
        resolutions.map(async (resolution, index) => {
          if (!isLocated(resolution)) throw new Error('Unresolved');
          const target = [note.target, ...(note.targets ?? [])][index];
          return {
            ...(await pdf.getPage(resolution.page)).createAnnotationAnchor(
              resolution.offset,
              resolution.length ?? target.canonicalLength,
            ),
            verification: 'verified' as const,
          };
        }),
      );
      const updated = await window.a11yNotebook!.vault.updatePdfAnnotation(path, note.id, {
        target: anchors[0],
        ...(anchors.length > 1 ? { targets: anchors.slice(1) } : {}),
      });
      if (version !== generation.current) return;
      const resolved = await resolveNote(updated);
      if (version !== generation.current) return;
      setNotes((previous) => previous.map((item) => (item.note.id === note.id ? resolved : item)));
      setMessage('PDF note location manually verified.');
    } catch {
      if (version === generation.current) setError('Could not verify PDF note.');
    } finally {
      operation.current = false;
      if (version === generation.current) setBusy(false);
    }
  };

  return (
    <section aria-label="PDF notes" className="pdf-notes">
      <button ref={createButton} type="button" onClick={() => createSelection()} disabled={!rendered || !notesLoaded}>
        Create PDF note
      </button>
      <button
        type="button"
        disabled={!rendered || !notesLoaded}
        onClick={() => {
          if (!rendered || !semanticRef.current) return;
          const range = semanticPdfRange(currentSemantic.current, semanticRef.current, rendered.page.pageNum);
          if (range) void begin([range]);
          else setError('Focus a paragraph, heading, or table cell in the accessible page text first.');
        }}
      >
        Annotate current semantic element
      </button>
      <p className="pdf-note-instructions">
        Select text, focus an accessible paragraph, heading or cell, or create a note by finding a quotation. Only one
        PDF page is displayed at a time.
      </p>
      <p role="status">{message}</p>
      {error ? <p role="alert">{error}</p> : null}
      {notes.length ? (
        <ul aria-label="Saved PDF notes">
          {notes.map((item) => {
            const { note, resolutions } = item;
            const orphaned = resolutions.some((resolution) => !isLocated(resolution));
            const unverified = resolutions.some(
              (resolution) => resolution.verification !== 'verified' || resolution.confidence !== 'certain',
            );
            return (
              <li key={note.id}>
                <button
                  type="button"
                  ref={(element) => {
                    if (element) controls.current.set(note.id, element);
                    else controls.current.delete(note.id);
                  }}
                  onClick={() => {
                    const index = resolutions.findIndex(isLocated);
                    const resolution = resolutions[index];
                    if (resolution && isLocated(resolution))
                      onNavigate(
                        resolution.page,
                        resolution.offset,
                        resolution.length ?? [note.target, ...(note.targets ?? [])][index].canonicalLength,
                      );
                    else setMessage('This note has no unique location. Review its original quotation below.');
                  }}
                >
                  {note.label || 'PDF note'} — {note.color === 'none' ? 'outline only' : note.color}, page{' '}
                  {note.target.page}
                </button>
                {note.comment ? <p>{note.comment}</p> : null}
                {orphaned || unverified ? (
                  <div className="pdf-note-warning">
                    <p>
                      {orphaned
                        ? 'Orphaned or ambiguous note: no unique location found.'
                        : 'Unverified note: review the location before trusting this highlight.'}
                    </p>
                    <blockquote>
                      {[note.target, ...(note.targets ?? [])].map((target) => target.exactQuote).join('\n')}
                    </blockquote>
                    <p>
                      {resolutions
                        .map((resolution) => resolution.reason)
                        .filter(Boolean)
                        .join(' ') || 'The stored quotation needs review.'}
                    </p>
                    {!orphaned ? (
                      <button type="button" disabled={busy} onClick={() => void verify(item)}>
                        Verify location for {note.label || 'PDF note'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <button type="button" disabled={busy} onClick={() => void remove(note)}>
                  Delete {note.label || 'PDF note'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {quoteDialog ? (
        <PdfQuoteDialog
          document={pdf}
          loadedPages={loadedPages}
          onChoose={(range) => void begin([range])}
          onClose={() => setQuoteDialog(false)}
        />
      ) : null}
      {targets ? (
        <PdfNoteDialog
          quote={targets.map((target) => target.exactQuote).join('\n')}
          onSave={save}
          onClose={() => setTargets(null)}
        />
      ) : null}
    </section>
  );
}
