import type ePubFactory from 'epubjs/src/index.js';
import type { EpubTocItem } from 'epubjs/src/index.js';
import DOMPurify from 'dompurify';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { imageUrl } from '../../../shared/attachments';
import { applyPdfReadingPreferences, PdfDocument, type PdfPage } from '../../pdf-semantic';
import { usePdfReadingPreferences } from '../../hooks/usePdfReadingPreferences';
import { createDocumentReaderModel, type DocumentReaderModel } from './document-reader-model';
import PdfNotes, { type PdfRenderedPage } from './PdfNotes';
import PdfUnavailableNotes from './PdfUnavailableNotes';
import DocxReader from './DocxReader';
import Modal from '../../components/Modal';
import { ANNOTATION_COLORS } from '../../../shared/annotations';
import {
  formatEpubAnnotationsExport,
  type EpubAnnotation,
  type EpubAnnotationAnchor,
} from '../../../shared/epub-annotations';

const EPUB_HIGHLIGHT_FILLS: Record<EpubAnnotation['color'], string> = {
  yellow: '#ffe082',
  green: '#a5d6a7',
  blue: '#90caf9',
  pink: '#f48fb1',
};

function normalizeEpubText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function EpubAnnotationDialog({
  quote,
  initial,
  busy,
  onClose,
  onSave,
}: {
  quote: string;
  initial?: EpubAnnotation;
  busy: boolean;
  onClose: () => void;
  onSave: (values: { color: EpubAnnotation['color']; label: string; comment: string }) => void;
}) {
  const id = useId();
  const [color, setColor] = useState<EpubAnnotation['color']>(initial?.color ?? 'yellow');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  return (
    <Modal titleId={`${id}-title`} title={initial ? 'Edit ePub annotation' : 'Add ePub annotation'} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ color, label: label.trim(), comment });
        }}
      >
        <blockquote>{quote}</blockquote>
        <div>
          <label htmlFor={`${id}-color`}>Highlight color</label>
          <select
            id={`${id}-color`}
            value={color}
            onChange={(event) => setColor(event.target.value as EpubAnnotation['color'])}
          >
            {ANNOTATION_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-label`}>Highlight label</label>
          <input id={`${id}-label`} value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-comment`}>Comment</label>
          <textarea
            id={`${id}-comment`}
            value={comment}
            maxLength={10_000}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <div>
          <button type="submit" disabled={busy || !label.trim()}>
            {busy ? 'Saving…' : 'Save annotation'}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_SEARCHABLE_PAGES = 500;
const MAX_SEARCHABLE_TEXT = 20 * 1024 * 1024;

interface Props {
  path: string;
  kind: '.pdf' | '.epub' | '.docx';
}

type ByteDocumentProps = Omit<Props, 'kind'> & { kind: '.pdf' | '.epub' };

const emptyDocument: DocumentReaderModel = createDocumentReaderModel([]);

function useDocumentBytes(path: string, kind: ByteDocumentProps['kind']) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadedPath, setLoadedPath] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    setError('');
    void fetch(imageUrl(path))
      .then(async (response) => {
        if (!response.ok) throw new Error(`The ${kind.slice(1)} file could not be read.`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw new Error('This document is too large to preview.');
        if (!cancelled) {
          setLoadedPath(path);
          setBytes(new Uint8Array(buffer));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'The document could not be opened.');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  return { bytes: loadedPath === path ? bytes : null, error };
}

function PdfReader({ bytes, path }: { bytes: Uint8Array; path: string }) {
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [readerModel, setReaderModel] = useState<DocumentReaderModel>(emptyDocument);
  const [activePage, setActivePage] = useState<PdfPage | null>(null);
  const [loadingText, setLoadingText] = useState(true);
  const [search, setSearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const visualRef = useRef<HTMLDivElement>(null);
  const semanticRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const readerRef = useRef<HTMLElement>(null);
  const [rendered, setRendered] = useState<PdfRenderedPage | null>(null);
  const pendingNote = useRef<{ page: number; offset: number; length: number } | null>(null);
  const preferences = usePdfReadingPreferences();
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  useEffect(() => {
    document?.setReadingPreferences(preferences);
    if (visualRef.current) applyPdfReadingPreferences(visualRef.current, preferences);
    if (semanticRef.current) applyPdfReadingPreferences(semanticRef.current, preferences);
  }, [document, preferences]);

  useEffect(() => {
    let cancelled = false;
    let pdf: PdfDocument | undefined;
    const hashBytes = bytes.slice().buffer as ArrayBuffer;
    void crypto.subtle
      .digest('SHA-256', hashBytes)
      .then((hash) => Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''))
      .then(async (fileHash) => {
        if (cancelled) return;
        pdf = new PdfDocument(bytes, fileHash, path, preferencesRef.current);
        await pdf.ready;
        if (cancelled) return;
        const sections: Array<{ label: string; text: string }> = [];
        let size = 0;
        for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_SEARCHABLE_PAGES); pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const text = page.textModel.fullText;
          size += text.length;
          if (size > MAX_SEARCHABLE_TEXT) break;
          sections.push({ label: page.label, text });
          if (cancelled) break;
        }
        if (!cancelled) {
          await pdf.classifyUntaggedPages(sections.map((_, index) => index + 1));
          if (cancelled) return;
          setDocument(pdf);
          setPageCount(pdf.numPages);
          setReaderModel(createDocumentReaderModel(sections));
          setLoadingText(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRenderError('This PDF could not be read. Use Open in external app to continue.');
          setLoadingText(false);
        }
      });
    return () => {
      cancelled = true;
      void pdf?.destroy().catch(() => undefined);
    };
  }, [bytes, path]);

  useEffect(() => {
    let cancelled = false;
    const visual = visualRef.current;
    const semantic = semanticRef.current;
    if (!document || !visual || !semantic) return;
    setRendered(null);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        setActivePage(page);
        const effectiveRotation = (page.canRotate + rotation) % 360;
        const renderScale = Math.min(
          zoom,
          2000 / (effectiveRotation % 180 ? page.view[3] - page.view[1] : page.view[2] - page.view[0]),
          2600 / (effectiveRotation % 180 ? page.view[2] - page.view[0] : page.view[3] - page.view[1]),
          Math.sqrt(4_000_000 / ((page.view[2] - page.view[0]) * (page.view[3] - page.view[1]))),
        );
        const transform = page.viewportTransform(renderScale, rotation);
        const canvas = page.renderCanvas(renderScale, rotation);
        return canvas.then((renderedCanvas) => {
          if (cancelled) return;
          visual.replaceChildren(renderedCanvas);
          renderedCanvas.className = 'document-page-canvas';
          renderedCanvas.setAttribute('aria-hidden', 'true');
          const layer = page.getTextLayer(renderScale, rotation);
          layer.style.width = `${(transform.rotation % 180 ? page.view[3] - page.view[1] : page.view[2] - page.view[0]) * renderScale}px`;
          layer.style.height = `${(transform.rotation % 180 ? page.view[2] - page.view[0] : page.view[3] - page.view[1]) * renderScale}px`;
          visual.append(layer);
          layer.setAttribute('aria-hidden', 'true');
          semantic.replaceChildren(page.getSemanticDOM(zoom, rotation));
          for (const block of semantic.querySelectorAll<HTMLElement>(
            'p,h1,h2,h3,h4,h5,h6,td,th,li,blockquote,[role="heading"],[role="cell"]',
          )) {
            if (
              block.querySelector('[data-start-offset]') &&
              !block.closest('[data-pdf-artifact-type]') &&
              !block.querySelector('[data-pdf-artifact-type]')
            ) {
              block.tabIndex = 0;
              block.dataset.context = 'pdf-semantic';
            }
          }
          applyPdfReadingPreferences(visual, preferencesRef.current);
          applyPdfReadingPreferences(semantic, preferencesRef.current);
          setRendered({ page, scale: renderScale, rotation });
          const note = pendingNote.current;
          if (note?.page === page.pageNum) {
            page.selectTextRange(note.offset, note.length, semantic);
            const span = Array.from(semantic.querySelectorAll<HTMLElement>('[data-start-offset]')).find(
              (candidate) =>
                Number(candidate.dataset.startOffset) <= note.offset &&
                Number(candidate.dataset.endOffset) > note.offset,
            );
            span?.closest<HTMLElement>('[tabindex]')?.focus();
            pendingNote.current = null;
          }
        });
      })
      .catch(() => {
        if (!cancelled) setRenderError('This PDF page could not be rendered. The extracted text remains available.');
      });
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber, rotation, zoom]);

  const matchingPages = readerModel.findSections(search);
  const currentMatch = matchingPages.length ? matchingPages[searchIndex % matchingPages.length] : undefined;

  return (
    <section
      ref={readerRef}
      tabIndex={-1}
      aria-label="PDF document reader"
      data-context="pdf-selection"
      data-pdf-path={path}
    >
      <h3>
        {activePage?.label ?? `Page ${pageNumber}`} of {pageCount || '…'}
      </h3>
      <div role="group" aria-label="PDF page navigation">
        <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => Math.max(1, page - 1))}>
          Previous page
        </button>
        <button
          type="button"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))}
        >
          Next page
        </button>
      </div>
      <div role="group" aria-label="PDF view controls">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} disabled={zoom <= 0.5}>
          Zoom out
        </button>
        <output aria-label="PDF zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.25))} disabled={zoom >= 2}>
          Zoom in
        </button>
        <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)}>
          Rotate page
        </button>
      </div>
      <label>
        Find in PDF
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSearchIndex(0);
          }}
        />
      </label>
      <p role="status">
        {loadingText ? 'Extracting accessible text.' : search ? `${matchingPages.length} matching pages.` : ''}
        {readerModel.sections.length < pageCount && !loadingText
          ? ` Search covers the first ${readerModel.sections.length} pages only.`
          : ''}
      </p>
      {matchingPages.length ? (
        <button
          type="button"
          onClick={() => {
            setPageNumber(currentMatch! + 1);
            setSearchIndex((index) => (index + 1) % matchingPages.length);
          }}
        >
          Next search result ({searchIndex + 1} of {matchingPages.length})
        </button>
      ) : null}
      <div ref={visualRef} className="document-page-visual" />
      {renderError ? <p role="alert">{renderError}</p> : null}
      <section aria-label={`Accessible text for PDF page ${pageNumber}`} aria-live="polite">
        <h4>Page text</h4>
        <div ref={semanticRef}>
          {readerModel.sections[pageNumber - 1]?.text ||
            (loadingText ? 'Extracting text…' : 'No extractable text was found on this page.')}
        </div>
      </section>
      {document ? (
        <PdfNotes
          document={document}
          path={path}
          loadedPages={readerModel.sections.length}
          readerRef={readerRef}
          visualRef={visualRef}
          semanticRef={semanticRef}
          rendered={rendered}
          onNavigate={(page, offset, length) => {
            pendingNote.current = { page, offset, length };
            if (page === pageNumber && activePage && semanticRef.current) {
              activePage.selectTextRange(offset, length, semanticRef.current);
              const span = Array.from(semanticRef.current.querySelectorAll<HTMLElement>('[data-start-offset]')).find(
                (candidate) =>
                  Number(candidate.dataset.startOffset) <= offset && Number(candidate.dataset.endOffset) > offset,
              );
              span?.closest<HTMLElement>('[tabindex]')?.focus();
              pendingNote.current = null;
            } else setPageNumber(page);
          }}
        />
      ) : renderError ? (
        <PdfUnavailableNotes path={path} reason={renderError} />
      ) : null}
    </section>
  );
}

function EpubToc({ items, onSelect }: { items: EpubTocItem[]; onSelect: (href: string) => void }) {
  return (
    <ol>
      {items.map((item) => (
        <li key={item.href}>
          <button type="button" onClick={() => onSelect(item.href)}>
            {item.label}
          </button>
          {item.subitems?.length ? <EpubToc items={item.subitems} onSelect={onSelect} /> : null}
        </li>
      ))}
    </ol>
  );
}

function EpubReader({ bytes, path }: { bytes: Uint8Array; path: string }) {
  const [readerModel, setReaderModel] = useState<DocumentReaderModel>(emptyDocument);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [book, setBook] = useState<Awaited<ReturnType<typeof ePubFactory>> | null>(null);
  const [epubAnnotations, setEpubAnnotations] = useState<EpubAnnotation[]>([]);
  const [sectionTexts, setSectionTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const [pendingCapture, setPendingCapture] = useState<EpubAnnotationAnchor | null>(null);
  const [epubDraft, setEpubDraft] = useState<{ anchor: EpubAnnotationAnchor; editing?: EpubAnnotation } | null>(null);
  const [epubBusy, setEpubBusy] = useState(false);
  const [epubStatus, setEpubStatus] = useState('');
  const appliedHighlightsRef = useRef(new Map<string, string>());
  const [renditionTick, setRenditionTick] = useState(0);
  const renditionRef = useRef<ReturnType<Awaited<ReturnType<typeof ePubFactory>>['renderTo']> | null>(null);
  const renditionContainerRef = useRef<HTMLDivElement>(null);
  const pendingHrefRef = useRef<string | null>(null);
  const pendingCfiRef = useRef<string | null>(null);
  const [positionReady, setPositionReady] = useState(false);
  const sectionIndexRef = useRef(0);
  sectionIndexRef.current = sectionIndex;
  const lastLocationRef = useRef<{ cfi: string; sectionIndex: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the saved reading position before displaying anything, so reopening
  // a book resumes where the reader stopped instead of restarting it.
  useEffect(() => {
    let cancelled = false;
    const vault = window.a11yNotebook?.vault;
    if (!vault?.getReadingPosition) {
      setPositionReady(true);
      return;
    }
    void vault
      .getReadingPosition(path)
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          if (saved.cfi) pendingCfiRef.current = saved.cfi;
          if (saved.sectionIndex > 0) setSectionIndex(saved.sectionIndex);
        }
        setPositionReady(true);
      })
      .catch(() => {
        if (!cancelled) setPositionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const queueSavePosition = useCallback(
    (cfi: string, index: number) => {
      lastLocationRef.current = { cfi, sectionIndex: index };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const location = lastLocationRef.current;
        const vault = window.a11yNotebook?.vault;
        if (location && vault?.setReadingPosition) {
          void vault.setReadingPosition(path, location).catch(() => undefined);
        }
      }, 600);
    },
    [path],
  );

  // Flush a pending position when the reader closes.
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const location = lastLocationRef.current;
      const vault = window.a11yNotebook?.vault;
      if (location && vault?.setReadingPosition) {
        void vault.setReadingPosition(path, location).catch(() => undefined);
      }
    },
    [path],
  );

  useEffect(() => {
    let cancelled = false;
    const vault = window.a11yNotebook?.vault;
    if (!vault?.listEpubAnnotations) return;
    void vault
      .listEpubAnnotations(path)
      .then((items) => {
        if (!cancelled) setEpubAnnotations(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);

  // An annotation is orphaned when its section text is available and the
  // quote no longer appears in it; sections past the search-text cap
  // cannot be verified and are treated as anchored rather than condemned.
  const epubStatuses = useMemo(() => {
    const statuses = new Map<string, 'anchored' | 'orphan'>();
    for (const annotation of epubAnnotations) {
      const text = sectionTexts.get(annotation.anchor.sectionHref);
      statuses.set(
        annotation.id,
        text !== undefined && !text.includes(normalizeEpubText(annotation.anchor.quote)) ? 'orphan' : 'anchored',
      );
    }
    return statuses;
  }, [epubAnnotations, sectionTexts]);

  const captureFromCfi = useCallback(
    (cfiRange: string, quoteText: string) => {
      if (!book || !quoteText) return;
      let sectionHref = '';
      try {
        const spine = book.spine as unknown as { get?: (target: string) => { href?: string } | undefined };
        sectionHref = spine.get?.(cfiRange)?.href ?? '';
      } catch {
        sectionHref = '';
      }
      if (!sectionHref) return;
      const text = sectionTexts.get(sectionHref) ?? '';
      const quote = normalizeEpubText(quoteText);
      const at = text.indexOf(quote);
      setPendingCapture({
        cfiRange,
        sectionHref,
        quote,
        prefix: at >= 0 ? text.slice(Math.max(0, at - 64), at) : '',
        suffix: at >= 0 ? text.slice(at + quote.length, at + quote.length + 64) : '',
      });
    },
    [book, sectionTexts],
  );
  const captureRef = useRef(captureFromCfi);
  captureRef.current = captureFromCfi;

  const beginEpubAnnotation = useCallback(() => {
    if (!pendingCapture) {
      setEpubStatus('Select text in the book view before adding an annotation.');
      return;
    }
    setEpubStatus('');
    setEpubDraft({ anchor: pendingCapture });
  }, [pendingCapture]);

  const saveEpubAnnotation = useCallback(
    async (values: { color: EpubAnnotation['color']; label: string; comment: string }) => {
      const vault = window.a11yNotebook?.vault;
      if (!vault || !epubDraft) return;
      setEpubBusy(true);
      try {
        if (epubDraft.editing) {
          const saved = await vault.updateEpubAnnotation(path, epubDraft.editing.id, values);
          setEpubAnnotations((items) => items.map((item) => (item.id === saved.id ? saved : item)));
        } else {
          const saved = await vault.addEpubAnnotation({ path, anchor: epubDraft.anchor, ...values });
          setEpubAnnotations((items) => [...items, saved]);
        }
        setEpubDraft(null);
        setEpubStatus('Annotation saved.');
      } catch {
        setEpubStatus('The annotation could not be saved.');
      } finally {
        setEpubBusy(false);
      }
    },
    [epubDraft, path],
  );

  const deleteEpubAnnotation = useCallback(
    async (annotation: EpubAnnotation) => {
      const vault = window.a11yNotebook?.vault;
      if (!vault) return;
      setEpubBusy(true);
      try {
        await vault.deleteEpubAnnotation(path, annotation.id);
        setEpubAnnotations((items) => items.filter((item) => item.id !== annotation.id));
        setEpubStatus('Annotation deleted.');
      } catch {
        setEpubStatus('The annotation could not be deleted.');
      } finally {
        setEpubBusy(false);
      }
    },
    [path],
  );

  useEffect(() => {
    let cancelled = false;
    let book: Awaited<ReturnType<typeof ePubFactory>> | undefined;
    void import('epubjs/src/index.js')
      .then(({ default: ePub }) =>
        ePub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
      )
      .then(async (opened) => {
        if (cancelled) {
          opened.destroy();
          return;
        }
        book = opened;
        setBook(opened);
        for (const section of opened.spine.spineItems) {
          section.hooks.serialize.register(function (this: { output: string }, content: string) {
            this.output = DOMPurify.sanitize(content, {
              FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
            });
          });
        }
        const items = opened.spine.spineItems.slice(0, MAX_SEARCHABLE_PAGES);
        const loaded: Array<{ label: string; text: string }> = [];
        const texts = new Map<string, string>();
        let size = 0;
        for (const section of items) {
          const content = await section.load();
          const text = content.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          size += text.length;
          if (size > MAX_SEARCHABLE_TEXT) break;
          loaded.push({ label: section.href.split('/').at(-1) || `Section ${section.index + 1}`, text });
          texts.set(section.href, text);
          if (cancelled) break;
        }
        if (!cancelled) {
          setReaderModel(createDocumentReaderModel(loaded));
          setSectionTexts(texts);
        }
      })
      .catch(() => {
        if (!cancelled) setError('This ePub could not be opened. Use Open in external app to continue.');
      });
    return () => {
      cancelled = true;
      book?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (!book || !renditionContainerRef.current) return;
    const rendition = book.renderTo(renditionContainerRef.current, {
      width: '100%',
      height: '60vh',
      flow: 'paginated',
    });
    const labelFrames = () => {
      renditionContainerRef.current?.querySelectorAll('iframe').forEach((frame) => {
        if (!frame.title) frame.title = 'ePub content';
      });
    };
    const observer = new MutationObserver(labelFrames);
    observer.observe(renditionContainerRef.current, { childList: true, subtree: true });
    labelFrames();
    renditionRef.current = rendition;
    setRenditionTick((tick) => tick + 1);
    // epub.js emits 'relocated' after every display or page turn; its bundled
    // types omit the event API, so it is reached through a structural view.
    const evented = rendition as unknown as {
      on?: (event: string, handler: (location: { start?: { cfi?: string } }) => void) => void;
    };
    if (typeof evented.on === 'function') {
      const selectable = rendition as unknown as {
        on?: (event: string, handler: (...args: never[]) => void) => void;
      };
      selectable.on?.('selected', ((cfiRange: string, contents: { range?: (cfi: string) => Range }) => {
        try {
          const range = contents?.range?.(cfiRange);
          captureRef.current(cfiRange, range?.toString() ?? '');
        } catch {
          // A selection that cannot be read simply does not arm the button.
        }
      }) as never);
      // Keyboard selections inside a section view may never fire
      // epub.js's 'selected' (it listens for pointer selection), so also
      // watch each rendered view's selection directly and derive the CFI.
      selectable.on?.('rendered', ((section: { cfiFromRange?: (range: Range) => string }, view: { document?: Document; contents?: { cfiFromRange?: (range: Range) => string } }) => {
        const doc = view?.document;
        if (!doc) return;
        doc.addEventListener('selectionchange', () => {
          const selection = doc.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const range = selection.getRangeAt(0);
          try {
            const cfi = view.contents?.cfiFromRange?.(range) ?? section?.cfiFromRange?.(range);
            if (cfi) captureRef.current(cfi, range.toString());
          } catch {
            // Best effort only; the pointer path above remains primary.
          }
        });
      }) as never);
      evented.on('relocated', (location) => {
        const cfi = location?.start?.cfi;
        if (!cfi) return;
        let index = sectionIndexRef.current;
        try {
          const spine = book.spine as unknown as { get?: (target: string) => { index?: number } | undefined };
          const section = spine.get?.(cfi);
          if (section && typeof section.index === 'number') index = section.index;
        } catch {
          // Keep the section the controls already show.
        }
        if (index !== sectionIndexRef.current) setSectionIndex(index);
        queueSavePosition(cfi, index);
      });
    }
    return () => {
      observer.disconnect();
      renditionRef.current = null;
    };
  }, [book, queueSavePosition]);

  // Keep the rendition's highlights in sync with the stored annotations.
  useEffect(() => {
    const rendition = renditionRef.current as unknown as {
      annotations?: {
        add: (type: string, cfi: string, data: object, cb: () => void, className: string, styles: object) => void;
        remove: (cfi: string, type: string) => void;
      };
    } | null;
    if (!rendition?.annotations) return;
    const applied = appliedHighlightsRef.current;
    const wanted = new Map(epubAnnotations.map((annotation) => [annotation.id, annotation]));
    for (const [id, cfi] of [...applied]) {
      if (!wanted.has(id) || wanted.get(id)!.anchor.cfiRange !== cfi) {
        try {
          rendition.annotations.remove(cfi, 'highlight');
        } catch {
          // Removing a stale highlight is best effort.
        }
        applied.delete(id);
      }
    }
    for (const annotation of epubAnnotations) {
      if (applied.get(annotation.id) === annotation.anchor.cfiRange) continue;
      try {
        rendition.annotations.add('highlight', annotation.anchor.cfiRange, {}, () => undefined, 'a11y-epub-highlight', {
          fill: EPUB_HIGHLIGHT_FILLS[annotation.color],
          'fill-opacity': '0.45',
        });
        applied.set(annotation.id, annotation.anchor.cfiRange);
      } catch {
        // A CFI the rendition rejects simply renders no highlight; the
        // pane still lists the annotation with its status.
      }
    }
  }, [epubAnnotations, book, renditionTick]);

  useEffect(() => {
    if (!positionReady) return;
    const section = book?.spine.spineItems[sectionIndex];
    if (!section || !renditionRef.current) return;
    const target = pendingCfiRef.current ?? pendingHrefRef.current ?? section.href;
    pendingCfiRef.current = null;
    pendingHrefRef.current = null;
    void renditionRef.current.display(target).catch(() => {
      setError('This ePub section could not be rendered. Its accessible text remains available.');
    });
  }, [book, sectionIndex, positionReady]);

  const matchingSections = readerModel.findSections(search);
  const activeSection = readerModel.sections[sectionIndex];

  return (
    <section aria-label="ePub document reader">
      <h3>
        Section {sectionIndex + 1} of {readerModel.sections.length || '…'}
      </h3>
      <div role="group" aria-label="ePub section navigation">
        <button
          type="button"
          disabled={sectionIndex <= 0}
          onClick={() => setSectionIndex((index) => Math.max(0, index - 1))}
        >
          Previous section
        </button>
        <button
          type="button"
          disabled={sectionIndex >= readerModel.sections.length - 1}
          onClick={() => setSectionIndex((index) => Math.min(readerModel.sections.length - 1, index + 1))}
        >
          Next section
        </button>
        <button type="button" onClick={beginEpubAnnotation}>
          Annotate selection
        </button>
      </div>
      {book?.navigation.toc.length ? (
        <nav aria-label="ePub table of contents">
          <h4>Table of contents</h4>
          <EpubToc
            items={book.navigation.toc}
            onSelect={(href) => {
              const index = book.spine.spineItems.findIndex((section) => section.href === href.split('#')[0]);
              if (index >= 0 && index !== sectionIndex) {
                pendingHrefRef.current = href;
                setSectionIndex(index);
              } else {
                void renditionRef.current?.display(href).catch(() => {
                  setError('This ePub section could not be rendered. Its accessible text remains available.');
                });
              }
            }}
          />
        </nav>
      ) : null}
      <div ref={renditionContainerRef} className="epub-rendition" />
      <label>
        Find in ePub
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <p role="status">{search ? `${matchingSections.length} matching sections.` : ''}</p>
      {matchingSections.map((index) => (
        <button key={index} type="button" onClick={() => setSectionIndex(index)}>
          Go to {readerModel.sections[index].label}
        </button>
      ))}
      {error ? (
        <p role="alert">{error}</p>
      ) : activeSection ? (
        <article aria-label={activeSection.label}>
          <h4>{activeSection.label}</h4>
          <p>{activeSection.text || 'No extractable text was found in this section.'}</p>
        </article>
      ) : (
        <p>Loading ePub content…</p>
      )}
      <section aria-label="ePub annotations">
        <h4>Annotations</h4>
        {epubStatus ? <p role="status">{epubStatus}</p> : null}
        {!epubAnnotations.length ? <p>No annotations for this book.</p> : null}
        <ul>
          {epubAnnotations.map((annotation) => {
            const status = epubStatuses.get(annotation.id) ?? 'anchored';
            return (
              <li key={annotation.id} data-annotation-id={annotation.id}>
                <strong>{annotation.label}</strong> <span>({annotation.color} highlight)</span>
                <blockquote>{annotation.anchor.quote}</blockquote>
                {annotation.comment ? <p>{annotation.comment}</p> : null}
                {status === 'orphan' ? (
                  <p>Highlight unavailable: the quoted text no longer appears in its section.</p>
                ) : null}
                <button
                  type="button"
                  disabled={status === 'orphan'}
                  aria-label={`Jump to annotation: ${annotation.label}`}
                  onClick={() => {
                    void renditionRef.current?.display(annotation.anchor.cfiRange).catch(() => {
                      setEpubStatus('That annotation could not be opened in the book view.');
                    });
                  }}
                >
                  Jump to text
                </button>{' '}
                <button
                  type="button"
                  disabled={epubBusy}
                  aria-label={`Edit annotation: ${annotation.label}`}
                  onClick={() => setEpubDraft({ anchor: annotation.anchor, editing: annotation })}
                >
                  Edit
                </button>{' '}
                <button
                  type="button"
                  disabled={epubBusy}
                  aria-label={`Delete annotation: ${annotation.label}`}
                  onClick={() => void deleteEpubAnnotation(annotation)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
        {epubAnnotations.length ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  formatEpubAnnotationsExport(
                    path,
                    epubAnnotations.map((annotation) => ({
                      annotation,
                      status: epubStatuses.get(annotation.id) ?? 'anchored',
                    })),
                  ),
                );
                setEpubStatus(
                  `Copied ${epubAnnotations.length} annotation${epubAnnotations.length === 1 ? '' : 's'} to the clipboard.`,
                );
              } catch {
                setEpubStatus('Could not copy annotations to the clipboard.');
              }
            }}
          >
            Copy annotations to clipboard
          </button>
        ) : null}
      </section>
      {epubDraft ? (
        <EpubAnnotationDialog
          quote={epubDraft.editing?.anchor.quote ?? epubDraft.anchor.quote}
          initial={epubDraft.editing}
          busy={epubBusy}
          onClose={() => setEpubDraft(null)}
          onSave={(values) => void saveEpubAnnotation(values)}
        />
      ) : null}
    </section>
  );
}

function ByteDocumentReader({ path, kind }: ByteDocumentProps) {
  const { bytes, error } = useDocumentBytes(path, kind);
  return error ? (
    <>
      <p role="alert">{error}</p>
      {kind === '.pdf' ? <PdfUnavailableNotes key={path} path={path} reason={error} /> : null}
    </>
  ) : !bytes ? (
    <p role="status">Loading {kind.slice(1)} document…</p>
  ) : kind === '.pdf' ? (
    <PdfReader key={path} bytes={bytes} path={path} />
  ) : (
    <EpubReader key={path} bytes={bytes} path={path} />
  );
}

export default function DocumentReader({ path, kind }: Props) {
  if (kind === '.docx') return <DocxReader path={path} />;
  return <ByteDocumentReader path={path} kind={kind} />;
}
