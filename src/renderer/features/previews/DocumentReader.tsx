import type ePubFactory from 'epubjs/src/index.js';
import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../../../shared/attachments';
import { applyPdfReadingPreferences, PdfDocument, type PdfPage } from '../../pdf-semantic';
import { usePdfReadingPreferences } from '../../hooks/usePdfReadingPreferences';
import { createDocumentReaderModel, type DocumentReaderModel } from './document-reader-model';
import PdfNotes, { type PdfRenderedPage } from './PdfNotes';
import PdfUnavailableNotes from './PdfUnavailableNotes';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_SEARCHABLE_PAGES = 500;
const MAX_SEARCHABLE_TEXT = 20 * 1024 * 1024;

interface Props {
  path: string;
  kind: '.pdf' | '.epub';
}

const emptyDocument: DocumentReaderModel = createDocumentReaderModel([]);

function useDocumentBytes(path: string, kind: Props['kind']) {
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

function EpubReader({ bytes }: { bytes: Uint8Array }) {
  const [readerModel, setReaderModel] = useState<DocumentReaderModel>(emptyDocument);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

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
        const items = opened.spine.spineItems.slice(0, MAX_SEARCHABLE_PAGES);
        const loaded: Array<{ label: string; text: string }> = [];
        let size = 0;
        for (const section of items) {
          const content = await section.load();
          const text = content.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          size += text.length;
          if (size > MAX_SEARCHABLE_TEXT) break;
          loaded.push({ label: section.href.split('/').at(-1) || `Section ${section.index + 1}`, text });
          if (cancelled) break;
        }
        if (!cancelled) setReaderModel(createDocumentReaderModel(loaded));
      })
      .catch(() => {
        if (!cancelled) setError('This ePub could not be opened. Use Open in external app to continue.');
      });
    return () => {
      cancelled = true;
      book?.destroy();
    };
  }, [bytes]);

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
      </div>
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
    </section>
  );
}

export default function DocumentReader({ path, kind }: Props) {
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
    <EpubReader bytes={bytes} />
  );
}
