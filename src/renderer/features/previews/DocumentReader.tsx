import type { EpubBook, EpubTocItem } from 'epubjs/src/index.js';
import DOMPurify from 'dompurify';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { imageUrl } from '../../../shared/attachments';
import { isAliusPath } from '../../../shared/alius';
import { mergeOcrTexts, type OcrPageResult } from '../../../shared/ocr';
import {
  describePdfFormFillState,
  detectPdfXfa,
  missingRequiredPdfFormFields,
  validatePdfFormValue,
  type PdfFormField,
  type PdfFormSkippedField,
  type PdfFormValue,
  type PdfFormValues,
} from '../../../shared/pdf-form';
import { applyPdfReadingPreferences, PdfDocument, type PdfPage } from '../../pdf-semantic';
import { syncFormFieldValues } from '../../pdf-semantic/pdf-form-dom';
import { savePdfReadingPreferences, usePdfReadingPreferences } from '../../hooks/usePdfReadingPreferences';
import { createDocumentReaderModel } from './document-reader-model';
import { epubInitialSectionIndex, epubSectionLabel, epubSectionText, epubTocLabels, openEpubBook } from './epub-book';
import OcrDialog from './OcrDialog';
import type { OcrEngine, OcrEngineLogger } from './ocr-engine';
import { buildOcrEpub, buildOcrPdf } from './ocr-save';
import { extractEpubSectionImages } from './ocr-images';
import type { OcrRunUnit } from './ocr-runner';
import PdfNotes, { type PdfRenderedPage } from './PdfNotes';
import PdfUnavailableNotes from './PdfUnavailableNotes';
import { groupedPdfSelection, semanticPdfRange } from './pdf-note-selection';
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

/** A page and the spot on it inside a PDF: the character offset in that page's extracted text. */
export interface PdfBookmarkSpot {
  page: number;
  offset: number;
}

/** What the app uses to set and jump to PDF bookmarks in the open reader. */
export interface PdfBookmarkApi {
  /** The reader's current page and spot, or null when the PDF has not loaded. */
  getCurrentSpot: () => PdfBookmarkSpot | null;
  /** Open the page and land focus and the selection on the spot. */
  jumpToSpot: (spot: PdfBookmarkSpot) => Promise<boolean>;
}

/** One page of layers for a PDF spot lookup: the accessible-text host and the visual text layer for that page. */
interface PdfSpotLayer {
  page: number;
  element: HTMLElement;
}

/**
 * The spot under the reader's selection: a selected range starts there,
 * and a collapsed caret sits there. Offsets are character positions in
 * the page's extracted text, read off the spans that carry them.
 */
function pdfSpotFromSelection(layers: PdfSpotLayer[]): PdfBookmarkSpot | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) {
    const grouped = groupedPdfSelection(selection, layers);
    if (grouped.length) return { page: grouped[0].page, offset: grouped[0].start };
  }
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const span = element?.closest<HTMLElement>('[data-start-offset]');
  if (!span) return null;
  const layer = layers.find(({ element: host }) => host.contains(span));
  if (!layer) return null;
  const start = Number(span.dataset.startOffset);
  const end = Number(span.dataset.endOffset);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  const prefix = span.ownerDocument.createRange();
  prefix.selectNodeContents(span);
  try {
    prefix.setEnd(node, range.startOffset);
  } catch {
    return { page: layer.page, offset: start };
  }
  const within = Math.min(end - start, Math.max(0, prefix.toString().length));
  return { page: layer.page, offset: start + within };
}

/** The spot at the focused block in the reader's accessible text. */
function pdfSpotFromFocus(layers: PdfSpotLayer[]): PdfBookmarkSpot | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return null;
  const layer = layers.find(({ element: host }) => host.contains(focused));
  if (!layer) return null;
  const range = semanticPdfRange(focused, layer.element, layer.page);
  if (range) return { page: range.page, offset: range.start };
  const span = focused.closest<HTMLElement>('[data-start-offset]');
  if (!span) return null;
  const start = Number(span.dataset.startOffset);
  return Number.isInteger(start) ? { page: layer.page, offset: start } : null;
}

/**
 * Land on a bookmarked spot in already-rendered page text: select from
 * the bookmarked offset to the end of its span — a text-node range, the
 * way Find selects a match, so the virtual cursor follows — and focus
 * the containing block. Returns true only when focus and a live
 * selection are both in place. A page with no extractable text has no
 * span to land on: focus the page text container itself instead.
 *
 * With an exact length (a PDF annotation), the selection covers the
 * annotated text itself; when that exact range cannot be selected —
 * the file changed since the annotation was saved — it falls back to
 * the span-end selection so the landing still reaches the spot.
 */
function landOnPdfSpot(host: HTMLElement, page: PdfPage, spot: PdfBookmarkSpot, length?: number): boolean {
  const spans = [...host.querySelectorAll<HTMLElement>('[data-start-offset]')];
  if (!spans.length) {
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    host.focus();
    try {
      host.scrollIntoView({ block: 'start' });
    } catch {
      // Scrolling is best-effort; the focus landing is what matters.
    }
    return document.activeElement === host;
  }
  let span = spans.find(
    (candidate) =>
      spot.offset >= Number(candidate.dataset.startOffset) && spot.offset < Number(candidate.dataset.endOffset),
  );
  let offset = spot.offset;
  if (!span) {
    // The bookmarked offset is past the end of the page's current text
    // (the file changed since the bookmark was set): clamp to the
    // nearest span instead of failing the jump.
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (offset < Number(first.dataset.startOffset)) {
      span = first;
      offset = Number(first.dataset.startOffset);
    } else {
      span = last;
      offset = Number(last.dataset.startOffset);
    }
  }
  const spanLength = Math.max(1, Number(span.dataset.endOffset) - offset);
  const block = span.closest<HTMLElement>('[tabindex]');
  if (!block) return false;
  // Focus first, then select: focusing after selecting can drop the
  // selection, leaving focus without a place for the virtual cursor.
  block.focus();
  try {
    block.scrollIntoView({ block: 'start' });
  } catch {
    // Scrolling is best-effort; the focus landing is what matters.
  }
  const selected =
    length !== undefined && length > 0
      ? page.selectTextRange(offset, length, host) || page.selectTextRange(offset, spanLength, host)
      : page.selectTextRange(offset, spanLength, host);
  const selection = window.getSelection();
  return (
    document.activeElement === block &&
    selected &&
    !!selection?.anchorNode &&
    selection.anchorNode.nodeType === Node.TEXT_NODE &&
    block.contains(selection.anchorNode)
  );
}

/** The render scale for one PDF page, capped the way the paginated render caps it. */
function pdfPageRenderScale(page: PdfPage, zoom: number, rotation: number): number {
  const effectiveRotation = (page.canRotate + rotation) % 360;
  return Math.min(
    zoom,
    2000 / (effectiveRotation % 180 ? page.view[3] - page.view[1] : page.view[2] - page.view[0]),
    2600 / (effectiveRotation % 180 ? page.view[2] - page.view[0] : page.view[3] - page.view[1]),
    Math.sqrt(4_000_000 / ((page.view[2] - page.view[0]) * (page.view[3] - page.view[1]))),
  );
}

/** Display size of one rendered PDF page, in CSS pixels. */
function pdfPageDisplaySize(
  page: PdfPage,
  scale: number,
  rotation: number,
): { width: number; height: number } {
  const transform = page.viewportTransform(scale, rotation);
  return {
    width: (transform.rotation % 180 ? page.view[3] - page.view[1] : page.view[2] - page.view[0]) * scale,
    height: (transform.rotation % 180 ? page.view[2] - page.view[0] : page.view[3] - page.view[1]) * scale,
  };
}
// How often a stale 'relocated' may make the reader re-assert the section
// the app asked for, before it gives up re-displaying and just ignores
// further stale reports. Stale reports are finite (one per display epub.js
// still had in flight), so this cap is only a safety net against a
// pathological loop; the label stays correct either way.
const MAX_EPUB_STALE_REDISPLAYS = 3;

/**
 * Passwords for protected PDFs, kept only in memory for the session so
 * a PDF asks for its password once instead of on every open. Never
 * persisted, never sent anywhere but the PDF opener.
 */
const pdfPasswords = new Map<string, string>();

interface Props {
  path: string;
  kind: '.pdf' | '.epub' | '.docx';
  /**
   * App's Ctrl+S calls the OCR save function registered here, when
   * temporary OCR text is showing — the same shortcut as saving a note.
   */
  ocrSaveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Engine factory for OCR; defaults to the real on-device engine. Tests pass a fake. */
  ocrEngineFactory?: (language: string, onLogger: OcrEngineLogger) => Promise<OcrEngine>;
  /**
   * The app registers the open PDF reader's bookmark API here — the
   * current page and spot, and the jump to one — the same ref pattern
   * as the OCR save function above.
   */
  pdfBookmarkRef?: MutableRefObject<PdfBookmarkApi | null>;
}

type ByteDocumentProps = Omit<Props, 'kind'> & { kind: '.pdf' | '.epub' };


function useDocumentBytes(path: string, kind: ByteDocumentProps['kind'], reloadKey = 0) {
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
  }, [kind, path, reloadKey]);

  return { bytes: loadedPath === path ? bytes : null, error };
}

function PdfReader({
  bytes,
  path,
  ocrSaveRef,
  ocrEngineFactory,
  pdfBookmarkRef,
  ocrStatus,
  setOcrStatus,
  onReload,
}: {
  bytes: Uint8Array;
  path: string;
  ocrSaveRef?: MutableRefObject<(() => Promise<void>) | null>;
  ocrEngineFactory?: (language: string, onLogger: OcrEngineLogger) => Promise<OcrEngine>;
  pdfBookmarkRef?: MutableRefObject<PdfBookmarkApi | null>;
  ocrStatus: string;
  setOcrStatus: (value: string) => void;
  onReload: () => void;
}) {
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [baseSections, setBaseSections] = useState<Array<{ label: string; text: string }>>([]);
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
  /**
   * Continuous view: the whole document in one scrolling page instead of
   * one page at a time. PDFs open in Continuous view unless the saved
   * view choice says Paginated; switching the view saves the choice, so
   * the next PDF opens in the view last picked.
   */
  const [continuous, setContinuous] = useState(() => preferences.continuousView);
  /** The reader follows a saved view choice loaded after it opened, until the view is picked here. */
  const userChoseViewRef = useRef(false);
  useEffect(() => {
    if (!userChoseViewRef.current) setContinuous(preferences.continuousView);
  }, [preferences.continuousView]);
  function choosePdfView(value: boolean) {
    userChoseViewRef.current = true;
    setContinuous(value);
    void savePdfReadingPreferences({ ...preferencesRef.current, continuousView: value }).catch(() => {
      console.warn('Could not save the PDF view choice.');
    });
  }
  const pageNumberRef = useRef(pageNumber);
  pageNumberRef.current = pageNumber;
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  /** Programmatic page moves in continuous view scroll that page into view. */
  const scrollToPageRef = useRef<number | null>(null);
  /** Pages rendered in continuous view, keyed by page number. */
  const continuousPagesRef = useRef(new Map<number, PdfRenderedPage>());
  /** Pages whose canvas has been rendered in continuous view. */
  const continuousCanvasesRef = useRef(new Set<number>());
  /** Guards lazy canvas renders against a stale continuous render. */
  const continuousGenerationRef = useRef(0);
  /** A bookmark jump waiting for its page to render. */
  const pendingBookmarkJump = useRef<PdfBookmarkSpot | null>(null);
  const activePageRef = useRef<PdfPage | null>(null);
  activePageRef.current = activePage;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const renderedRef = useRef<PdfRenderedPage | null>(null);
  renderedRef.current = rendered;
  // Fillable forms: fields sit inline in the reading view, values are
  // stored in the app, and a filled file comes from an export.
  const isAlius = isAliusPath(path);
  const hasXfa = useMemo(() => detectPdfXfa(bytes), [bytes]);
  const [formFields, setFormFields] = useState<PdfFormField[]>([]);
  const [formValues, setFormValues] = useState<PdfFormValues>({});
  const [formValuesLoaded, setFormValuesLoaded] = useState(false);
  const [formErrors, setFormErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [formStatus, setFormStatus] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordAttempt, setPasswordAttempt] = useState(0);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [wasPasswordProtected, setWasPasswordProtected] = useState(false);
  /** A protected PDF opened without a password: it reads, but it is read-only. */
  const [wasPermissionProtected, setWasPermissionProtected] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  /** Fields the last filled-PDF export could not write, with their reasons. */
  const [exportSkippedFields, setExportSkippedFields] = useState<PdfFormSkippedField[]>([]);
  // OCR ("OCR this file"): temporary results, shown in the reader until
  // the user saves them with Ctrl+S or the dialog's Save button.
  const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
  const [ocrResults, setOcrResults] = useState<Map<number, OcrPageResult> | null>(null);
  const [ocrSaveBusy, setOcrSaveBusy] = useState(false);
  const valuesRef = useRef<PdfFormValues>({});
  const errorsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const valuesDirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFieldFocus = useRef<string | null>(null);
  const passwordAttemptedRef = useRef(false);

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
        const password = pdfPasswords.get(path);
        pdf = new PdfDocument(bytes, fileHash, path, preferencesRef.current, password ? { password } : {});
        await pdf.ready;
        if (cancelled) return;
        if (password) setWasPasswordProtected(true);
        else if (pdf.permissionProtected) setWasPermissionProtected(true);
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
          setBaseSections(sections);
          setLoadingText(false);
          const fields = (await pdf.getFormFields?.().catch(() => [] as PdfFormField[])) ?? [];
          if (!cancelled) setFormFields(fields);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        // A password-protected PDF asks for its password once instead of
        // failing the open; a wrong password reports as such.
        if (reason instanceof Error && reason.name === 'PasswordException') {
          if (passwordAttemptedRef.current) {
            pdfPasswords.delete(path);
            setPasswordError('That password did not open the PDF. Try again.');
          }
          setNeedsPassword(true);
          setLoadingText(false);
          return;
        }
        setRenderError('This PDF could not be read. Use Open in external app to continue.');
        setLoadingText(false);
      });
    return () => {
      cancelled = true;
      void pdf?.destroy().catch(() => undefined);
    };
  }, [bytes, path, passwordAttempt]);

  // Filled values live in the app, keyed by this document's path, and
  // load when the reader opens.
  useEffect(() => {
    let cancelled = false;
    const vault = window.a11yNotebook?.vault;
    if (!vault?.getPdfFormValues) {
      setFormValuesLoaded(true);
      return;
    }
    void vault
      .getPdfFormValues(path)
      .then((saved) => {
        if (cancelled) return;
        valuesRef.current = saved;
        setFormValues(saved);
        setFormValuesLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setFormValuesLoaded(true);
          setFormStatus('The saved filled values could not be loaded.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Debounced save of filled values, flushed when the reader closes.
  useEffect(() => {
    if (!formValuesLoaded || !document || !valuesDirtyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const vault = window.a11yNotebook?.vault;
      if (!vault?.savePdfFormValues) return;
      valuesDirtyRef.current = false;
      void vault
        .savePdfFormValues(path, valuesRef.current, document.documentIdentity)
        .then(() => setFormStatus('Filled values saved.'))
        .catch(() => {
          valuesDirtyRef.current = true;
          setFormStatus('The filled values could not be saved.');
        });
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [formValues, formValuesLoaded, document, path]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const vault = window.a11yNotebook?.vault;
      if (valuesDirtyRef.current && vault?.savePdfFormValues && document) {
        valuesDirtyRef.current = false;
        void vault.savePdfFormValues(path, valuesRef.current, document.documentIdentity).catch(() => undefined);
      }
    },
    [document, path],
  );

  const handleFormFieldChange = useCallback(
    (name: string, value: PdfFormValue) => {
      const next = { ...valuesRef.current, [name]: value };
      valuesRef.current = next;
      valuesDirtyRef.current = true;
      setFormValues(next);
      const field = formFields.find((candidate) => candidate.name === name);
      if (field) {
        const problem = validatePdfFormValue(field, value);
        const errors = new Map(errorsRef.current);
        if (problem) errors.set(name, problem);
        else errors.delete(name);
        errorsRef.current = errors;
        setFormErrors(errors);
      }
    },
    [formFields],
  );
  const formChangeRef = useRef(handleFormFieldChange);
  formChangeRef.current = handleFormFieldChange;

  const submitPassword = useCallback(() => {
    if (!passwordInput) {
      setPasswordError('Enter the PDF password.');
      return;
    }
    pdfPasswords.set(path, passwordInput);
    passwordAttemptedRef.current = true;
    setPasswordError('');
    setNeedsPassword(false);
    setPasswordAttempt((attempt) => attempt + 1);
  }, [passwordInput, path]);

  // Keep already-rendered inline controls in step with stored values
  // and errors without rebuilding the page (canvas, text layer).
  useEffect(() => {
    if (!semanticRef.current || !activePage) return;
    syncFormFieldValues(semanticRef.current, activePage.formFields ?? [], formValues, formErrors);
    const pending = pendingFieldFocus.current;
    if (pending) {
      const control = semanticRef.current.querySelector<HTMLElement>(
        `[data-pdf-form-field="${CSS.escape(pending)}"] input, [data-pdf-form-field="${CSS.escape(pending)}"] select, [data-pdf-form-field="${CSS.escape(pending)}"] textarea`,
      );
      if (control) {
        control.focus();
        pendingFieldFocus.current = null;
      }
    }
  }, [formValues, formErrors, activePage]);

  /** Turn to a page; in continuous view the page also scrolls into view. */
  const goToPage = useCallback((page: number) => {
    if (continuousRef.current) {
      scrollToPageRef.current = page;
      // The scroll tracker only follows real scrolling, so a programmatic
      // move also makes the page current now: the heading, notes, and
      // form fields track it immediately.
      const entry = continuousPagesRef.current.get(page);
      if (entry) {
        setActivePage(entry.page);
        setRendered(entry);
      }
    }
    setPageNumber(page);
  }, []);

  const goToFormField = useCallback(
    (field: PdfFormField) => {
      pendingFieldFocus.current = field.name;
      goToPage(field.page);
    },
    [goToPage],
  );

  /** The page's rendered text host for a spot landing: the whole semantic container when paginated, one page wrapper in continuous view. */
  const pdfSpotHost = useCallback((page: number): HTMLElement | null => {
    const semantic = semanticRef.current;
    if (!semantic) return null;
    return continuousRef.current ? semantic.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`) : semantic;
  }, []);

  /** The rendered page object for a spot landing, or null when that page is not the rendered one. */
  const pdfSpotPage = useCallback((page: number): PdfPage | null => {
    if (continuousRef.current) return continuousPagesRef.current.get(page)?.page ?? null;
    const active = activePageRef.current;
    return active && active.pageNum === page ? active : null;
  }, []);

  /** True once the target page's accessible text is rendered and landable. */
  const isPdfSpotRendered = useCallback((page: number): boolean => {
    if (continuousRef.current) return continuousPagesRef.current.has(page);
    return renderedRef.current?.page.pageNum === page;
  }, []);

  /**
   * The reader's current page and spot: the selection first, then the
   * focused block, then the top of the current page when the reader has
   * no position yet. The visual text layer counts for a selection too,
   * so a mouse selection in the page counts the same as one in the
   * accessible text.
   */
  const getCurrentPdfSpot = useCallback((): PdfBookmarkSpot | null => {
    if (!document) return null;
    const semantic = semanticRef.current;
    if (!semantic) return null;
    const layers: PdfSpotLayer[] = [];
    if (continuousRef.current) {
      for (const host of [semantic, visualRef.current]) {
        if (!host) continue;
        for (const wrapper of host.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
          const page = Number(wrapper.dataset.pdfPage);
          if (Number.isInteger(page)) layers.push({ page, element: wrapper });
        }
      }
    } else {
      layers.push({ page: pageNumberRef.current, element: semantic });
      if (visualRef.current) layers.push({ page: pageNumberRef.current, element: visualRef.current });
    }
    return pdfSpotFromSelection(layers) ?? pdfSpotFromFocus(layers) ?? { page: pageNumberRef.current, offset: 0 };
  }, [document]);

  /**
   * Jump to a bookmarked page and spot. The page turn renders
   * asynchronously, so the jump waits for the page's accessible text:
   * the render effects land a pending jump the moment they render its
   * page, and this poll lands it when the page is already rendered (a
   * jump on the current page renders nothing new). A page number beyond
   * the document fails fast once the page count is known; a document
   * that never loads fails when the wait runs out.
   */
  const jumpToPdfSpot = useCallback(
    (spot: PdfBookmarkSpot): Promise<boolean> => {
      if (spot.page < 1) return Promise.resolve(false);
      if (document && spot.page > pageCountRef.current) return Promise.resolve(false);
      pendingBookmarkJump.current = spot;
      goToPage(spot.page);
      return new Promise<boolean>((resolve) => {
        const started = Date.now();
        const tick = () => {
          if (!pendingBookmarkJump.current) {
            resolve(true);
            return;
          }
          if (pageCountRef.current > 0 && spot.page > pageCountRef.current) {
            pendingBookmarkJump.current = null;
            resolve(false);
            return;
          }
          if (isPdfSpotRendered(spot.page)) {
            const host = pdfSpotHost(spot.page);
            const page = pdfSpotPage(spot.page);
            const landed = !!host && !!page && landOnPdfSpot(host, page, spot);
            pendingBookmarkJump.current = null;
            resolve(landed);
            return;
          }
          if (Date.now() - started > 8000) {
            pendingBookmarkJump.current = null;
            resolve(false);
            return;
          }
          setTimeout(tick, 100);
        };
        // The first tick waits a beat so a programmatic page scroll in
        // continuous view settles before the landing scrolls the spot.
        setTimeout(tick, 50);
      });
    },
    [document, goToPage, isPdfSpotRendered, pdfSpotHost, pdfSpotPage],
  );

  // Register the bookmark API for the app; clear it when the reader closes.
  useEffect(() => {
    if (!pdfBookmarkRef) return;
    pdfBookmarkRef.current = { getCurrentSpot: getCurrentPdfSpot, jumpToSpot: jumpToPdfSpot };
    return () => {
      pdfBookmarkRef.current = null;
    };
  }, [pdfBookmarkRef, getCurrentPdfSpot, jumpToPdfSpot]);

  /**
   * Jump to a PDF annotation's page and spot: the annotated text
   * itself, not just its page. The page turn renders asynchronously,
   * so the jump waits for the page's accessible text the same way a
   * bookmark jump does — the render effects land a pending jump the
   * moment they render its page, and this poll lands it when the page
   * is already rendered (a jump on the current page renders nothing
   * new). The old annotation path selected first and focused after,
   * which can drop the selection, and in continuous view a jump to
   * another page never landed at all: the page scrolled but the
   * pending note was only consumed by the initial full render.
   * Returns true only when focus and a live selection both landed on
   * the annotated text.
   */
  const jumpToPdfAnnotation = useCallback(
    (page: number, offset: number, length: number): Promise<boolean> => {
      if (page < 1) return Promise.resolve(false);
      if (document && page > pageCountRef.current) return Promise.resolve(false);
      pendingNote.current = { page, offset, length };
      goToPage(page);
      return new Promise<boolean>((resolve) => {
        const started = Date.now();
        const tick = () => {
          if (!pendingNote.current) {
            resolve(true);
            return;
          }
          if (pageCountRef.current > 0 && page > pageCountRef.current) {
            pendingNote.current = null;
            resolve(false);
            return;
          }
          if (isPdfSpotRendered(page)) {
            const host = pdfSpotHost(page);
            const pdfPage = pdfSpotPage(page);
            const landed = !!host && !!pdfPage && landOnPdfSpot(host, pdfPage, { page, offset }, length);
            pendingNote.current = null;
            resolve(landed);
            return;
          }
          if (Date.now() - started > 8000) {
            pendingNote.current = null;
            resolve(false);
            return;
          }
          setTimeout(tick, 100);
        };
        // The first tick waits a beat so a programmatic page scroll in
        // continuous view settles before the landing scrolls the spot.
        setTimeout(tick, 50);
      });
    },
    [document, goToPage, isPdfSpotRendered, pdfSpotHost, pdfSpotPage],
  );

  const missingRequired = useMemo(
    () => missingRequiredPdfFormFields(formFields, formValues),
    [formFields, formValues],
  );
  const unsupportedFields = useMemo(
    () => formFields.filter((field) => field.type === 'unsupported'),
    [formFields],
  );

  // A skipped field belongs to the document it was exported from.
  useEffect(() => {
    setExportSkippedFields([]);
  }, [path]);

  // Temporary OCR text, merged into the reader only where the page had
  // no extractable text — a page that already reads keeps its own text.
  const ocrTextMap = useMemo(() => {
    if (!ocrResults) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const [index, result] of ocrResults) {
      if (result.text.trim()) map.set(index, result.text);
    }
    return map;
  }, [ocrResults]);
  const readerModel = useMemo(() => {
    const { texts } = mergeOcrTexts(
      baseSections.map((section) => section.text),
      ocrTextMap,
    );
    return createDocumentReaderModel(baseSections.map((section, index) => ({ label: section.label, text: texts[index] })));
  }, [baseSections, ocrTextMap]);
  /** Pages with no extractable text — the ones OCR reads. */
  const emptyPageIndexes = useMemo(
    () => baseSections.map((_, index) => index).filter((index) => !baseSections[index].text.trim()),
    [baseSections],
  );
  const currentPageHasOcrText = ocrTextMap.has(pageNumber - 1);
  const canSaveOcr =
    ocrResults !== null &&
    [...ocrResults.values()].some((result) => result.text.trim()) &&
    !wasPasswordProtected &&
    !wasPermissionProtected &&
    document !== null &&
    !ocrSaveBusy;

  /**
   * Save the temporary OCR text into the file — the Ctrl+S path. The
   * file is re-read first, so a change on disk since the open is not
   * overwritten blindly. A managed file updates in place; an Alius saves
   * a copy in the library and never touches the original.
   */
  const saveOcr = useCallback(async () => {
    const vault = window.a11yNotebook?.vault;
    if (!vault?.saveOcrText || !ocrResults || !document) return;
    const usable = new Map<number, OcrPageResult>();
    for (const [index, result] of ocrResults) {
      if (result.text.trim() && !baseSections[index]?.text.trim()) usable.set(index, result);
    }
    if (usable.size === 0) {
      setOcrStatus('There is no recognized text to save.');
      return;
    }
    setOcrSaveBusy(true);
    try {
      const fresh = await fetch(imageUrl(path)).then(async (response) => {
        if (!response.ok) throw new Error('The PDF could not be read again.');
        return new Uint8Array(await response.arrayBuffer());
      });
      const pageSizes = new Map<number, { width: number; height: number; rotation: number }>();
      for (const index of usable.keys()) {
        const page = await document.getPage(index + 1);
        const [x0, y0, x1, y1] = page.view;
        pageSizes.set(index, { width: x1 - x0, height: y1 - y0, rotation: page.canRotate });
      }
      const next = await buildOcrPdf(fresh, usable, pageSizes);
      const saved = await vault.saveOcrText(path, '.pdf', next);
      if (saved.copied) {
        setOcrStatus(`Saved OCR copy as ${saved.name}. The original file was not changed.`);
      } else {
        setOcrResults(null);
        setOcrStatus('OCR text saved into the file.');
        onReload();
      }
    } catch (reason) {
      setOcrStatus(reason instanceof Error ? reason.message : 'The OCR text could not be saved.');
    } finally {
      setOcrSaveBusy(false);
    }
  }, [ocrResults, document, baseSections, path, onReload, setOcrStatus]);

  // Register the save function for App's Ctrl+S while temporary OCR text
  // is showing; clear it when the text is saved or the reader closes.
  const saveOcrRef = useRef(saveOcr);
  saveOcrRef.current = saveOcr;
  useEffect(() => {
    if (!ocrSaveRef) return;
    ocrSaveRef.current = canSaveOcr ? () => saveOcrRef.current() : null;
    return () => {
      if (ocrSaveRef) ocrSaveRef.current = null;
    };
  }, [ocrSaveRef, canSaveOcr]);

  /** OCR units: one lazy render per page with no extractable text. */
  const prepareOcrUnits = useCallback(async (): Promise<OcrRunUnit[]> => {
    if (!document) return [];
    return emptyPageIndexes.map((index) => ({
      index,
      loadImages: async () => {
        const page = await document.getPage(index + 1);
        return [await page.renderCanvas(3, 0, 3)];
      },
    }));
  }, [document, emptyPageIndexes]);

  /** Required fields must be filled before a filled file is produced. */
  const validateForExport = useCallback((): boolean => {
    if (!missingRequired.length) return true;
    const errors = new Map(errorsRef.current);
    for (const field of missingRequired) errors.set(field.name, 'This field is required.');
    errorsRef.current = errors;
    setFormErrors(errors);
    setFormStatus(
      `${missingRequired.length} required field${missingRequired.length === 1 ? '' : 's'} still empty: ${missingRequired.map((field) => field.label).join(', ')}.`,
    );
    goToFormField(missingRequired[0]);
    return false;
  }, [missingRequired, goToFormField]);

  const downloadFilledPdf = useCallback(async () => {
    const vault = window.a11yNotebook?.vault;
    if (!vault?.downloadFilledPdf || !validateForExport()) return;
    setExportBusy(true);
    try {
      const result = await vault.downloadFilledPdf(path);
      const skipped = result.skippedFields ?? [];
      setExportSkippedFields(skipped);
      setFormStatus(
        result.saved
          ? `Downloaded filled PDF${result.fileName ? ` as ${result.fileName}` : ''}.${
              skipped.length
                ? ` ${skipped.length} field${skipped.length === 1 ? '' : 's'} could not be written: ${skipped.map((field) => field.name).join(', ')}.`
                : ''
            }`
          : 'Download cancelled.',
      );
    } catch (reason) {
      setFormStatus(reason instanceof Error ? reason.message : 'The filled PDF could not be downloaded.');
    } finally {
      setExportBusy(false);
    }
  }, [path, validateForExport]);

  const saveFilledPdfCopy = useCallback(async () => {
    const vault = window.a11yNotebook?.vault;
    if (!vault?.saveFilledPdfCopy || !validateForExport()) return;
    setExportBusy(true);
    try {
      const created = await vault.saveFilledPdfCopy(path);
      const skipped = created.skippedFields ?? [];
      setExportSkippedFields(skipped);
      setFormStatus(
        `Saved filled copy as ${created.name}. The original file was not changed.${
          skipped.length
            ? ` ${skipped.length} field${skipped.length === 1 ? '' : 's'} could not be written: ${skipped.map((field) => field.name).join(', ')}.`
            : ''
        }`,
      );
    } catch (reason) {
      setFormStatus(reason instanceof Error ? reason.message : 'The filled copy could not be saved.');
    } finally {
      setExportBusy(false);
    }
  }, [path, validateForExport]);

  // Paginated view: one page at a time. Continuous view renders in the
  // effect below, so this one stays out of its way while it is on.
  useEffect(() => {
    if (continuous) return;
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
          semantic.replaceChildren(
            page.getSemanticDOM(zoom, rotation, undefined, {
              values: valuesRef.current,
              errors: errorsRef.current,
              onChange: (name, value) => formChangeRef.current(name, value),
            }),
          );
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
          if (
            note?.page === page.pageNum &&
            landOnPdfSpot(semantic, page, { page: note.page, offset: note.offset }, note.length)
          ) {
            pendingNote.current = null;
          }
          const bookmarkJump = pendingBookmarkJump.current;
          if (bookmarkJump?.page === page.pageNum && landOnPdfSpot(semantic, page, bookmarkJump)) {
            pendingBookmarkJump.current = null;
          }
        });
      })
      .catch(() => {
        if (!cancelled) setRenderError('This PDF page could not be rendered. The extracted text remains available.');
      });
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber, rotation, zoom, continuous]);

  // Continuous view: the whole document in one scrolling page. The
  // accessible text for every page is rendered up front, so headings on
  // any page are navigable; each page's canvas renders lazily as it
  // approaches the viewport, so a long document does not hold a canvas
  // for every page at once. Where no IntersectionObserver exists (unit
  // tests), every canvas renders eagerly instead.
  useEffect(() => {
    if (!continuous || !document) return;
    let cancelled = false;
    const generation = ++continuousGenerationRef.current;
    const visual = visualRef.current;
    const semantic = semanticRef.current;
    if (!visual || !semantic) return;
    setRendered(null);
    continuousPagesRef.current = new Map();
    continuousCanvasesRef.current = new Set();
    let lazyObserver: IntersectionObserver | null = null;
    const renderCanvasForPage = async (targetPage: number) => {
      if (cancelled || generation !== continuousGenerationRef.current) return;
      if (continuousCanvasesRef.current.has(targetPage)) return;
      continuousCanvasesRef.current.add(targetPage);
      const entry = continuousPagesRef.current.get(targetPage);
      const host = visual.querySelector<HTMLElement>(`[data-pdf-page="${targetPage}"]`);
      if (!entry || !host) return;
      try {
        const canvas = await entry.page.renderCanvas(entry.scale, rotation);
        if (cancelled || generation !== continuousGenerationRef.current) return;
        canvas.className = 'document-page-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        const layer = entry.page.getTextLayer(entry.scale, rotation);
        const { width, height } = pdfPageDisplaySize(entry.page, entry.scale, rotation);
        layer.style.width = `${width}px`;
        layer.style.height = `${height}px`;
        layer.setAttribute('aria-hidden', 'true');
        host.append(canvas, layer);
      } catch {
        // A page whose canvas fails still keeps its accessible text.
        continuousCanvasesRef.current.delete(targetPage);
      }
    };
    const scrollPageIntoView = (targetPage: number) => {
      visual
        .querySelector<HTMLElement>(`[data-pdf-page="${targetPage}"]`)
        ?.scrollIntoView?.({ behavior: 'auto', block: 'start' });
    };
    void (async () => {
      try {
        visual.replaceChildren();
        semantic.replaceChildren();
        for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
          const page = await document.getPage(pageIndex);
          if (cancelled) return;
          const scale = pdfPageRenderScale(page, zoom, rotation);
          const { width, height } = pdfPageDisplaySize(page, scale, rotation);
          const visualWrapper = window.document.createElement('div');
          visualWrapper.className = 'document-page-visual-page';
          visualWrapper.dataset.pdfPage = String(pageIndex);
          visualWrapper.style.width = `${width}px`;
          visualWrapper.style.height = `${height}px`;
          visual.append(visualWrapper);
          const semanticWrapper = window.document.createElement('div');
          semanticWrapper.dataset.pdfPage = String(pageIndex);
          semantic.append(semanticWrapper);
          // Every page starts with a real heading, so heading navigation
          // (H in JAWS) moves through each page of the document in order.
          // The semantic text itself carries no headings unless the PDF
          // is tagged, so without this the whole document has only the
          // reader's "Page text" heading and there is nothing per page
          // to navigate to. The heading is a marker, not a tab stop.
          // Level 5 sits under the "Page text" (h4) section heading, so
          // the page markers do not outrank the reader's own headings.
          const pageHeading = window.document.createElement('h5');
          pageHeading.textContent = `Page ${pageIndex}`;
          semanticWrapper.replaceChildren(
            pageHeading,
            page.getSemanticDOM(zoom, rotation, undefined, {
              values: valuesRef.current,
              errors: errorsRef.current,
              onChange: (name, value) => formChangeRef.current(name, value),
            }),
          );
          for (const block of semanticWrapper.querySelectorAll<HTMLElement>(
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
          continuousPagesRef.current.set(pageIndex, { page, scale, rotation });
          if (pageIndex === pageNumberRef.current) {
            setActivePage(page);
            setRendered({ page, scale, rotation });
          }
        }
        applyPdfReadingPreferences(visual, preferencesRef.current);
        applyPdfReadingPreferences(semantic, preferencesRef.current);
        // The current page's canvas renders now; the rest render as they
        // approach the viewport, or all at once without an observer.
        await renderCanvasForPage(pageNumberRef.current);
        if (cancelled) return;
        if (typeof IntersectionObserver === 'function') {
          lazyObserver = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const target = Number((entry.target as HTMLElement).dataset.pdfPage);
                if (Number.isInteger(target)) void renderCanvasForPage(target);
              }
            },
            { rootMargin: '600px' },
          );
          for (const wrapper of visual.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
            lazyObserver.observe(wrapper);
          }
        } else {
          for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
            void renderCanvasForPage(pageIndex);
          }
        }
        const note = pendingNote.current;
        let noteLanded = false;
        if (note) {
          const entry = continuousPagesRef.current.get(note.page);
          const host = semantic.querySelector<HTMLElement>(`[data-pdf-page="${note.page}"]`);
          if (
            entry &&
            host &&
            landOnPdfSpot(host, entry.page, { page: note.page, offset: note.offset }, note.length)
          ) {
            pendingNote.current = null;
            scrollToPageRef.current = note.page;
            noteLanded = true;
          }
        }
        // A bookmark or annotation jump lands on its own spot, so the
        // page-top scroll below stays out of its way once the landing
        // is made.
        const bookmarkJump = pendingBookmarkJump.current;
        let bookmarkLanded = false;
        if (bookmarkJump) {
          const entry = continuousPagesRef.current.get(bookmarkJump.page);
          const host = semantic.querySelector<HTMLElement>(`[data-pdf-page="${bookmarkJump.page}"]`);
          if (entry && host && landOnPdfSpot(host, entry.page, bookmarkJump)) {
            pendingBookmarkJump.current = null;
            bookmarkLanded = true;
          }
        }
        const target = scrollToPageRef.current ?? pageNumberRef.current;
        scrollToPageRef.current = null;
        if (!bookmarkLanded && !noteLanded) scrollPageIntoView(target);
      } catch {
        if (!cancelled) setRenderError('This PDF could not be rendered. The extracted text remains available.');
      }
    })();
    return () => {
      cancelled = true;
      lazyObserver?.disconnect();
    };
  }, [document, continuous, pageCount, rotation, zoom]);

  // In continuous view the current page follows the scroll position, so
  // notes, form fields, and the page heading track the page in view.
  // The tracker reads both page stacks — the visual pages and the
  // accessible text below them. The visual stack alone is not enough:
  // a jump scrolls the landed text into view, which puts every visual
  // page above the viewport, so the visual stack alone reports the
  // last page and the heading stays on the old page. Reading both
  // stacks tracks the page the reader is actually on, after a jump
  // and while scrolling by hand.
  useEffect(() => {
    if (!continuous || !document) return;
    const visual = visualRef.current;
    if (!visual) return;
    let frame = 0;
    let ticking = false;
    const updateCurrentPage = () => {
      ticking = false;
      const visualWrappers = [...visual.querySelectorAll<HTMLElement>('[data-pdf-page]')];
      if (!visualWrappers.length) return;
      if (visualWrappers[0].getBoundingClientRect().height === 0) return;
      const semanticWrappers = [
        ...(semanticRef.current?.querySelectorAll<HTMLElement>('[data-pdf-page]') ?? []),
      ];
      // The current page is the page being read. The focused block
      // decides first: a jump lands focus on the landed text, and a
      // reader who clicked into a page's text is reading that page —
      // even when the page cannot scroll any further and its text sits
      // mid-viewport. When focus is not in the reader's text, the
      // text at the top of the reading area decides; and when the text
      // has not reached the top, the page at the middle of the
      // viewport does — a jump can leave the landed text short of the
      // top (the page cannot scroll any further, so the landed text
      // sits mid-viewport with the 140 line falling in the gap
      // between the last visual page and the first text page), and in
      // that state the middle of the viewport is on the landed page
      // while the visual stack alone still reports the last page.
      let current: number | null = null;
      const active = window.document.activeElement as HTMLElement | null;
      const focusedWrapper = active?.closest<HTMLElement>('[data-pdf-page]') ?? null;
      if (focusedWrapper && active) {
        const rect = active.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) current = Number(focusedWrapper.dataset.pdfPage);
      }
      if (current === null) {
        for (const wrapper of semanticWrappers) {
          if (wrapper.getBoundingClientRect().top <= 140) current = Number(wrapper.dataset.pdfPage);
          else break;
        }
      }
      if (current === null) {
        const middle = window.innerHeight / 2;
        current = 1;
        for (const wrapper of [...visualWrappers, ...semanticWrappers]) {
          if (wrapper.getBoundingClientRect().top <= middle) current = Number(wrapper.dataset.pdfPage);
          else break;
        }
      }
      if (current !== pageNumberRef.current) {
        const entry = continuousPagesRef.current.get(current);
        if (!entry) return;
        setPageNumber(current);
        setActivePage(entry.page);
        setRendered(entry);
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(updateCurrentPage);
      else updateCurrentPage();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    visual.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      visual.removeEventListener('scroll', onScroll);
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    };
  }, [continuous, document, pageCount]);

  // Programmatic page moves in continuous view scroll the target page
  // into view once its wrapper exists.
  useEffect(() => {
    if (!continuous) return;
    const target = scrollToPageRef.current;
    if (target === null) return;
    const wrapper = visualRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${target}"]`);
    if (!wrapper) return;
    scrollToPageRef.current = null;
    wrapper.scrollIntoView?.({ behavior: 'auto', block: 'start' });
  }, [pageNumber, continuous]);

  // Temporary OCR text lives in the semantic text area, alongside the
  // extracted text: the page render above replaces the semantic DOM on
  // every page turn, so this runs after it and re-appends the text. In
  // continuous view it goes to the current page's text, not the top of
  // the whole document.
  useEffect(() => {
    const semantic = semanticRef.current;
    if (!semantic) return;
    semantic.querySelector('[data-ocr-text]')?.remove();
    const text = ocrTextMap.get(pageNumber - 1);
    if (!text) return;
    const paragraph = window.document.createElement('p');
    paragraph.dataset.ocrText = 'true';
    paragraph.textContent = text;
    const host = continuous
      ? semantic.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`) ?? semantic
      : semantic;
    host.append(paragraph);
  }, [ocrTextMap, activePage, pageNumber, continuous]);

  const matchingPages = readerModel.findSections(search);
  const currentMatch = matchingPages.length ? matchingPages[searchIndex % matchingPages.length] : undefined;

  if (needsPassword) {
    return (
      <section ref={readerRef} tabIndex={-1} aria-label="PDF document reader" data-pdf-path={path}>
        <h3>Password-protected PDF</h3>
        <p>This PDF needs a password to open. Enter it once; it is kept only in memory for this session.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitPassword();
          }}
        >
          <label>
            PDF password
            <input
              type="password"
              autoComplete="off"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
            />
          </label>
          {passwordError ? <p role="alert">{passwordError}</p> : null}
          <button type="submit">Unlock PDF</button>
        </form>
      </section>
    );
  }

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
      {wasPermissionProtected ? (
        <p>
          This PDF is protected, so it opens read-only: notes and a filled file are unavailable. The filled values stay
          saved in the app.
        </p>
      ) : null}
      <div role="group" aria-label="PDF page navigation">
        <div role="radiogroup" aria-label="PDF view">
          <label>
            <input type="radio" name="pdf-view" checked={!continuous} onChange={() => choosePdfView(false)} />
            Paginated view
          </label>
          <label>
            <input type="radio" name="pdf-view" checked={continuous} onChange={() => choosePdfView(true)} />
            Continuous view
          </label>
        </div>
        {continuous ? null : (
          <>
            <button type="button" disabled={pageNumber <= 1} onClick={() => goToPage(Math.max(1, pageNumber - 1))}>
              Previous page
            </button>
            <button
              type="button"
              disabled={pageNumber >= pageCount}
              onClick={() => goToPage(Math.min(pageCount, pageNumber + 1))}
            >
              Next page
            </button>
          </>
        )}
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
        {emptyPageIndexes.length > 0 && !loadingText ? (
          <button type="button" onClick={() => setOcrDialogOpen(true)}>
            OCR this file
          </button>
        ) : null}
      </div>
      {ocrStatus ? <p role="status">{ocrStatus}</p> : null}
      {ocrDialogOpen ? (
        <OcrDialog
          kind=".pdf"
          total={emptyPageIndexes.length}
          isAlius={isAlius}
          onClose={() => setOcrDialogOpen(false)}
          onComplete={(results) => setOcrResults(results)}
          onSaveNow={() => saveOcr()}
          prepareUnits={prepareOcrUnits}
          createEngine={ocrEngineFactory}
        />
      ) : null}
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
            goToPage(currentMatch! + 1);
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
        {currentPageHasOcrText ? (
          <p>Recognized text (temporary). Press Ctrl+S to save it into the file.</p>
        ) : null}
        <div ref={semanticRef}>
          {continuous
            ? null
            : readerModel.sections[pageNumber - 1]?.text ||
              (loadingText ? 'Extracting text…' : 'No extractable text was found on this page.')}
        </div>
        {!loadingText && !baseSections[pageNumber - 1]?.text.trim() && emptyPageIndexes.length > 0 ? (
          <p>
            This page has no extractable text.{' '}
            <button type="button" onClick={() => setOcrDialogOpen(true)}>
              OCR this file
            </button>
          </p>
        ) : null}
      </section>
      {document && (formFields.length > 0 || hasXfa) ? (
        <section aria-label="Form fields">
          <h4>Form fields</h4>
          <p role="status">
            {formStatus ||
              (formFields.length
                ? describePdfFormFillState(formFields, formValues)
                : 'No fillable fields were found in this PDF.')}
          </p>
          {hasXfa ? (
            <p>
              {formFields.length
                ? 'This form uses XFA. The fields below could be loaded; dynamic XFA features may not work.'
                : 'This form uses XFA and no fields could be loaded in the app.'}
            </p>
          ) : null}
          {unsupportedFields.length || exportSkippedFields.length ? (
            <ul>
              {unsupportedFields.map((field) => (
                <li key={field.name}>
                  {field.label}: {field.unsupportedReason}
                </li>
              ))}
              {exportSkippedFields.map((skipped) => (
                <li key={`export-skipped-${skipped.name}`}>
                  {formFields.find((field) => field.name === skipped.name)?.label ?? skipped.name}:{' '}
                  {skipped.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {missingRequired.length ? (
            <>
              <p>Required fields still empty:</p>
              <ul>
                {missingRequired.map((field) => (
                  <li key={field.name}>
                    <button type="button" onClick={() => goToFormField(field)}>
                      Go to {field.label} (page {field.page})
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {isAlius ? (
            <p>
              Filling this Alius never changes the original file. Saving a filled copy creates a new file in the
              library.
            </p>
          ) : null}
          {wasPasswordProtected ? (
            <p>
              This PDF is password-protected, so a filled file cannot be created. The filled values stay saved in
              the app.
            </p>
          ) : null}
          <div role="group" aria-label="Filled PDF export">
            <button
              type="button"
              disabled={exportBusy || !formFields.length || wasPasswordProtected || wasPermissionProtected}
              onClick={() => void downloadFilledPdf()}
            >
              Download filled PDF
            </button>
            {isAlius ? (
              <button
                type="button"
                disabled={exportBusy || !formFields.length || wasPasswordProtected || wasPermissionProtected}
                onClick={() => void saveFilledPdfCopy()}
              >
                Save filled copy in library
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {document ? (
        <PdfNotes
          document={document}
          path={path}
          loadedPages={readerModel.sections.length}
          pageCount={pageCount}
          continuous={continuous}
          readerRef={readerRef}
          visualRef={visualRef}
          semanticRef={semanticRef}
          rendered={rendered}
          onNavigate={async (page, offset, length) => jumpToPdfAnnotation(page, offset, length)}
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

function EpubReader({
  bytes,
  path,
  ocrSaveRef,
  ocrEngineFactory,
  ocrStatus,
  setOcrStatus,
  onReload,
}: {
  bytes: Uint8Array;
  path: string;
  ocrSaveRef?: MutableRefObject<(() => Promise<void>) | null>;
  ocrEngineFactory?: (language: string, onLogger: OcrEngineLogger) => Promise<OcrEngine>;
  ocrStatus: string;
  setOcrStatus: (value: string) => void;
  onReload: () => void;
}) {
  const [baseSections, setBaseSections] = useState<Array<{ label: string; text: string }>>([]);
  // OCR ("OCR this file"): temporary results, shown in the reader until
  // the user saves them with Ctrl+S or the dialog's Save button.
  const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
  const [ocrResults, setOcrResults] = useState<Map<number, OcrPageResult> | null>(null);
  const [ocrSaveBusy, setOcrSaveBusy] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [book, setBook] = useState<EpubBook | null>(null);
  const [epubAnnotations, setEpubAnnotations] = useState<EpubAnnotation[]>([]);
  const [sectionTexts, setSectionTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const [pendingCapture, setPendingCapture] = useState<EpubAnnotationAnchor | null>(null);
  const [epubDraft, setEpubDraft] = useState<{ anchor: EpubAnnotationAnchor; editing?: EpubAnnotation } | null>(null);
  const [epubBusy, setEpubBusy] = useState(false);
  const [epubStatus, setEpubStatus] = useState('');
  const appliedHighlightsRef = useRef(new Map<string, string>());
  const [renditionTick, setRenditionTick] = useState(0);
  const renditionRef = useRef<ReturnType<EpubBook['renderTo']> | null>(null);
  const renditionContainerRef = useRef<HTMLDivElement>(null);
  const pendingHrefRef = useRef<string | null>(null);
  const pendingCfiRef = useRef<string | null>(null);
  // The section the app last asked the rendition to display, while epub.js
  // has not yet confirmed it through 'relocated'. epub.js reports the
  // displayed section through that event, but the report lags the display
  // that caused it: it is queued behind the next display and its location
  // is only read on a later animation frame, so a report from the section
  // being left can arrive after the app has already asked for the next
  // one. While a navigation is outstanding, a report for any other section
  // is stale and must not move the section label, the accessible text, or
  // the saved reading position. pendingTargetRef keeps the exact target
  // (section href, table-of-contents fragment, or restored CFI) so a
  // stale report can also put the rendition back on the requested section
  // when epub.js itself moved it (it re-displays its last-reported
  // location after a resize). Both refs are null when no navigation is
  // outstanding; then a report is a genuine rendition-driven move (for
  // example jumping to an annotation in another section) and is accepted.
  const pendingSectionRef = useRef<number | null>(null);
  const pendingTargetRef = useRef<string | null>(null);
  const staleRedisplayRef = useRef(0);
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
          if (saved.sectionIndex !== undefined && saved.sectionIndex > 0) setSectionIndex(saved.sectionIndex);
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

  const pendingAnnotationJumpRef = useRef<EpubAnnotation | null>(null);
  const annotationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Land on an annotation's exact spot in the book view, the Find way:
  // resolve the stored CFI to a DOM range in the rendered section,
  // focus the element holding that range, and select the annotated text
  // as a text-node range — focus alone does not move a screen reader's
  // virtual cursor, and a whole-element selection leaves it where it
  // was. Returns true only when the landing is verified: the element
  // holds focus and a live, non-collapsed selection sits in its
  // document.
  const landOnEpubAnnotation = useCallback((annotation: EpubAnnotation): boolean => {
    const contents = renditionRef.current?.getContents() ?? [];
    for (const content of contents) {
      const doc = content?.document;
      let range: Range | null = null;
      try {
        range = content?.range(annotation.anchor.cfiRange) ?? null;
      } catch {
        range = null;
      }
      if (!doc || !range || range.collapsed) continue;
      // The range's start may sit on an element boundary: descend to
      // its first text node so the selection anchors on a text node,
      // the way Find anchors a match.
      let startNode: Node | null = range.startContainer;
      if (startNode.nodeType === Node.ELEMENT_NODE) {
        startNode = doc.createTreeWalker(startNode, NodeFilter.SHOW_TEXT).nextNode();
      }
      const element =
        startNode?.nodeType === Node.TEXT_NODE
          ? startNode.parentElement
          : (range.startContainer as HTMLElement | null);
      if (!element || !doc.contains(element)) continue;
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
      element.focus();
      // Focus can drop the selection: re-select the annotated range,
      // as Find does after moving focus to a match.
      const selection = doc.getSelection();
      if (!selection) continue;
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        element.scrollIntoView({ block: 'center' });
      } catch {
        // Scrolling is best-effort; the focus landing is what matters.
      }
      const reselected = doc.getSelection();
      if (
        doc.activeElement === element &&
        reselected &&
        reselected.rangeCount > 0 &&
        !reselected.isCollapsed &&
        !!reselected.anchorNode &&
        doc.contains(reselected.anchorNode)
      ) {
        return true;
      }
    }
    return false;
  }, []);

  const clearAnnotationRetryTimer = useCallback(() => {
    if (annotationRetryTimerRef.current) {
      clearTimeout(annotationRetryTimerRef.current);
      annotationRetryTimerRef.current = null;
    }
  }, []);

  // Attempt the landing for a pending annotation jump. The rendition's
  // contents may not be ready the moment a display resolves, so one
  // failure schedules a single delayed retry; if the spot still cannot
  // be found, say so honestly instead of silently doing nothing.
  const attemptAnnotationLanding = useCallback(
    (annotation: EpubAnnotation): boolean => {
      if (landOnEpubAnnotation(annotation)) {
        clearAnnotationRetryTimer();
        pendingAnnotationJumpRef.current = null;
        setEpubStatus(`Jumped to annotation: ${annotation.label}.`);
        return true;
      }
      if (!annotationRetryTimerRef.current) {
        annotationRetryTimerRef.current = setTimeout(() => {
          annotationRetryTimerRef.current = null;
          if (pendingAnnotationJumpRef.current?.id !== annotation.id) return;
          if (landOnEpubAnnotation(annotation)) {
            pendingAnnotationJumpRef.current = null;
            setEpubStatus(`Jumped to annotation: ${annotation.label}.`);
          } else {
            pendingAnnotationJumpRef.current = null;
            setEpubStatus('That annotation could not be located in the book view.');
          }
        }, 500);
      }
      return false;
    },
    [clearAnnotationRetryTimer, landOnEpubAnnotation],
  );
  const attemptAnnotationLandingRef = useRef(attemptAnnotationLanding);
  attemptAnnotationLandingRef.current = attemptAnnotationLanding;

  // Jump to an annotation: navigate to its section when needed, then
  // land on its exact spot. Routing a cross-section jump through the
  // section display effect (with the CFI as the pending target)
  // matters: a bare display() here would be undone when the section
  // change re-displays the section's href, landing the reader at the
  // section start instead of the annotation.
  const jumpToEpubAnnotation = useCallback(
    async (annotation: EpubAnnotation) => {
      const rendition = renditionRef.current;
      if (!rendition || !book) {
        setEpubStatus('That annotation could not be opened in the book view.');
        return;
      }
      const targetIndex = book.spine.spineItems.findIndex(
        (section) => section.href === annotation.anchor.sectionHref,
      );
      if (targetIndex < 0) {
        setEpubStatus('That annotation could not be found in this book.');
        return;
      }
      clearAnnotationRetryTimer();
      pendingAnnotationJumpRef.current = annotation;
      if (targetIndex !== sectionIndexRef.current) {
        pendingCfiRef.current = annotation.anchor.cfiRange;
        setSectionIndex(targetIndex);
        return;
      }
      try {
        await rendition.display(annotation.anchor.cfiRange);
      } catch {
        pendingAnnotationJumpRef.current = null;
        setEpubStatus('That annotation could not be opened in the book view.');
        return;
      }
      // display() resolves once the section is shown, but the relocated
      // report lags behind it (queued + requestAnimationFrame), so land
      // here as well; the relocated path retries if this attempt fails,
      // and a successful landing clears the pending jump so the later
      // report is a no-op.
      if (pendingAnnotationJumpRef.current) attemptAnnotationLanding(annotation);
    },
    [attemptAnnotationLanding, book, clearAnnotationRetryTimer],
  );

  // A pending jump's delayed retry must not fire after the reader closes.
  useEffect(
    () => () => {
      if (annotationRetryTimerRef.current) clearTimeout(annotationRetryTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let book: EpubBook | undefined;
    void openEpubBook(bytes)
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
        // Section headings come from the table of contents, the section
        // document's <title>, or the manifest file name — never from
        // section.href, which epubjs resolves to a blob: URL whose last
        // segment is the blob UUID (see epubSectionLabel).
        const tocLabels = epubTocLabels(opened.navigation.toc);
        let size = 0;
        for (const section of items) {
          // One section that cannot be loaded must not fail the whole
          // book: its accessible text stays empty and the section still
          // lists (and reports no extractable text) instead of the
          // reader showing "could not be opened" for a book that is
          // otherwise readable.
          let text = '';
          let title = '';
          try {
            const extracted = epubSectionText(await section.load());
            text = extracted.text;
            title = extracted.title;
          } catch {
            text = '';
            title = '';
          }
          size += text.length;
          if (size > MAX_SEARCHABLE_TEXT) break;
          loaded.push({ label: epubSectionLabel(section, title, tocLabels), text });
          texts.set(section.href, text);
          if (cancelled) break;
        }
        if (!cancelled) {
          setBaseSections(loaded);
          setSectionTexts(texts);
          // A book usually opens on its cover, which has no extractable
          // text: without this, the first thing a screen-reader user
          // hears on opening a book full of text is "No extractable text
          // was found in this section." Start at the first readable
          // section instead. Only while the reader is still on section 0:
          // a saved reading position (or the user's own navigation) has
          // already moved it, and that wins.
          if (sectionIndexRef.current === 0) {
            const start = epubInitialSectionIndex(
              items.map((section, index) => ({ href: section.href, text: loaded[index]?.text ?? '' })),
              opened.navigation.toc,
            );
            if (start > 0) setSectionIndex(start);
          }
        }
      })
      .catch((reason: unknown) => {
        // Log the underlying reason: the user-facing message alone gives
        // no diagnostic when a book fails to open.
        console.error('The ePub could not be opened:', reason);
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
        const pending = pendingSectionRef.current;
        if (pending !== null && index !== pending) {
          // A report for another section while the app's navigation is
          // still unconfirmed is stale: the rendition has not caught up
          // with the section the app asked for (or epub.js moved it back
          // to its stale last-reported location). Ignore it, and put the
          // rendition back on the requested section so the book view
          // matches the label and the accessible text.
          if (staleRedisplayRef.current < MAX_EPUB_STALE_REDISPLAYS) {
            staleRedisplayRef.current += 1;
            const target = pendingTargetRef.current ?? book.spine.spineItems[pending]?.href;
            if (target) {
              void renditionRef.current?.display(target).catch(() => {
                pendingSectionRef.current = null;
                pendingTargetRef.current = null;
              });
            }
          }
          return;
        }
        pendingSectionRef.current = null;
        pendingTargetRef.current = null;
        if (index !== sectionIndexRef.current) setSectionIndex(index);
        queueSavePosition(cfi, index);
        // A pending annotation jump lands once the rendition has
        // confirmed the move — but only when the report is for the
        // annotation's own section; a report for another section (the
        // user navigated away mid-jump) leaves the jump pending for a
        // return to that section.
        const pendingAnnotation = pendingAnnotationJumpRef.current;
        if (pendingAnnotation) {
          const annotationIndex = book.spine.spineItems.findIndex(
            (section) => section.href === pendingAnnotation.anchor.sectionHref,
          );
          if (annotationIndex >= 0 && annotationIndex === index) {
            attemptAnnotationLandingRef.current(pendingAnnotation);
          }
        }
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
    const section = book?.spine?.spineItems?.[sectionIndex];
    if (!section || !renditionRef.current) return;
    const target = pendingCfiRef.current ?? pendingHrefRef.current ?? section.href;
    pendingCfiRef.current = null;
    pendingHrefRef.current = null;
    pendingSectionRef.current = sectionIndex;
    pendingTargetRef.current = target;
    staleRedisplayRef.current = 0;
    void renditionRef.current.display(target).catch(() => {
      pendingSectionRef.current = null;
      pendingTargetRef.current = null;
      setError('This ePub section could not be rendered. Its accessible text remains available.');
    });
  }, [book, sectionIndex, positionReady]);

  // Temporary OCR text, merged into the reader only where the section
  // had no extractable text — a section that already reads keeps its own
  // text.
  const isAlius = isAliusPath(path);
  const ocrTextMap = useMemo(() => {
    if (!ocrResults) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const [index, result] of ocrResults) {
      if (result.text.trim()) map.set(index, result.text);
    }
    return map;
  }, [ocrResults]);
  const readerModel = useMemo(() => {
    const { texts } = mergeOcrTexts(
      baseSections.map((section) => section.text),
      ocrTextMap,
    );
    return createDocumentReaderModel(baseSections.map((section, index) => ({ label: section.label, text: texts[index] })));
  }, [baseSections, ocrTextMap]);
  /** Sections with no extractable text — the ones OCR reads. */
  const emptySectionIndexes = useMemo(
    () => baseSections.map((_, index) => index).filter((index) => !baseSections[index].text.trim()),
    [baseSections],
  );
  const currentSectionHasOcrText = ocrTextMap.has(sectionIndex);
  const canSaveOcr =
    ocrResults !== null &&
    [...ocrResults.values()].some((result) => result.text.trim()) &&
    book !== null &&
    !ocrSaveBusy;

  /**
   * Save the temporary OCR text into the file — the Ctrl+S path. The
   * file is re-read first, so a change on disk since the open is not
   * overwritten blindly. A managed file updates in place; an Alius saves
   * a copy in the library and never touches the original.
   */
  const saveOcr = useCallback(async () => {
    const vault = window.a11yNotebook?.vault;
    if (!vault?.saveOcrText || !ocrResults) return;
    const usable = new Map<number, string>();
    for (const [index, result] of ocrResults) {
      if (result.text.trim() && !baseSections[index]?.text.trim()) usable.set(index, result.text);
    }
    if (usable.size === 0) {
      setOcrStatus('There is no recognized text to save.');
      return;
    }
    setOcrSaveBusy(true);
    try {
      const fresh = await fetch(imageUrl(path)).then(async (response) => {
        if (!response.ok) throw new Error('The ePub could not be read again.');
        return new Uint8Array(await response.arrayBuffer());
      });
      const next = await buildOcrEpub(fresh, usable);
      const saved = await vault.saveOcrText(path, '.epub', next);
      if (saved.copied) {
        setOcrStatus(`Saved OCR copy as ${saved.name}. The original file was not changed.`);
      } else {
        setOcrResults(null);
        setOcrStatus('OCR text saved into the file.');
        onReload();
      }
    } catch (reason) {
      setOcrStatus(reason instanceof Error ? reason.message : 'The OCR text could not be saved.');
    } finally {
      setOcrSaveBusy(false);
    }
  }, [ocrResults, baseSections, path, onReload, setOcrStatus]);

  // Register the save function for App's Ctrl+S while temporary OCR text
  // is showing; clear it when the text is saved or the reader closes.
  const saveOcrRef = useRef(saveOcr);
  saveOcrRef.current = saveOcr;
  useEffect(() => {
    if (!ocrSaveRef) return;
    ocrSaveRef.current = canSaveOcr ? () => saveOcrRef.current() : null;
    return () => {
      if (ocrSaveRef) ocrSaveRef.current = null;
    };
  }, [ocrSaveRef, canSaveOcr]);

  /** OCR units: the embedded images of sections with no extractable text. */
  const prepareOcrUnits = useCallback(async (): Promise<OcrRunUnit[]> => {
    const extracted = await extractEpubSectionImages(bytes, emptySectionIndexes);
    const byIndex = new Map(extracted.map((unit) => [unit.index, unit.images]));
    return emptySectionIndexes.map((index) => ({
      index,
      loadImages: async () => byIndex.get(index) ?? [],
    }));
  }, [bytes, emptySectionIndexes]);

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
        {emptySectionIndexes.length > 0 ? (
          <button type="button" onClick={() => setOcrDialogOpen(true)}>
            OCR this file
          </button>
        ) : null}
      </div>
      {ocrStatus ? <p role="status">{ocrStatus}</p> : null}
      {ocrDialogOpen ? (
        <OcrDialog
          kind=".epub"
          total={emptySectionIndexes.length}
          isAlius={isAlius}
          onClose={() => setOcrDialogOpen(false)}
          onComplete={(results) => setOcrResults(results)}
          onSaveNow={() => saveOcr()}
          prepareUnits={prepareOcrUnits}
          createEngine={ocrEngineFactory}
        />
      ) : null}
      {book?.navigation?.toc?.length ? (
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
          {currentSectionHasOcrText ? (
            <p>Recognized text (temporary). Press Ctrl+S to save it into the file.</p>
          ) : null}
          <p>{activeSection.text || 'No extractable text was found in this section.'}</p>
          {!activeSection.text && emptySectionIndexes.length > 0 ? (
            <p>
              <button type="button" onClick={() => setOcrDialogOpen(true)}>
                OCR this file
              </button>
            </p>
          ) : null}
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
                    void jumpToEpubAnnotation(annotation);
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

function ByteDocumentReader({ path, kind, ocrSaveRef, ocrEngineFactory, pdfBookmarkRef }: ByteDocumentProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const { bytes, error } = useDocumentBytes(path, kind, reloadKey);
  // The OCR save status lives here, not in the inner reader: saving reloads
  // the reader (new key), which would wipe a status held inside it — and
  // the save announcement must reach the screen reader after the reload.
  const [ocrStatus, setOcrStatus] = useState('');
  useEffect(() => setOcrStatus(''), [path]);
  const requestReload = useCallback(() => setReloadKey((key) => key + 1), []);
  return error ? (
    <>
      <p role="alert">{error}</p>
      {kind === '.pdf' ? <PdfUnavailableNotes key={path} path={path} reason={error} /> : null}
    </>
  ) : !bytes ? (
    <p role="status">Loading {kind.slice(1)} document…</p>
  ) : kind === '.pdf' ? (
    <PdfReader
      key={`${path}:${reloadKey}`}
      bytes={bytes}
      path={path}
      ocrSaveRef={ocrSaveRef}
      ocrEngineFactory={ocrEngineFactory}
      pdfBookmarkRef={pdfBookmarkRef}
      ocrStatus={ocrStatus}
      setOcrStatus={setOcrStatus}
      onReload={requestReload}
    />
  ) : (
    <EpubReader
      key={`${path}:${reloadKey}`}
      bytes={bytes}
      path={path}
      ocrSaveRef={ocrSaveRef}
      ocrEngineFactory={ocrEngineFactory}
      ocrStatus={ocrStatus}
      setOcrStatus={setOcrStatus}
      onReload={requestReload}
    />
  );
}

export default function DocumentReader({ path, kind, ocrSaveRef, ocrEngineFactory, pdfBookmarkRef }: Props) {
  if (kind === '.docx') return <DocxReader path={path} />;
  return (
    <ByteDocumentReader
      path={path}
      kind={kind}
      ocrSaveRef={ocrSaveRef}
      ocrEngineFactory={ocrEngineFactory}
      pdfBookmarkRef={pdfBookmarkRef}
    />
  );
}
