import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type ePubFactory from 'epubjs/src/index.js';
import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../../../shared/attachments';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_SEARCHABLE_PAGES = 500;
const MAX_SEARCHABLE_TEXT = 20 * 1024 * 1024;

interface Props {
  path: string;
  kind: '.pdf' | '.epub';
}

type SectionText = { title: string; text: string };

function pageText(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>) {
  return page.getTextContent().then((content) =>
    content.items
      .flatMap((item) => ('str' in item ? [item.str] : []))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function useDocumentBytes(path: string, kind: Props['kind']) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
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
        if (!cancelled) setBytes(new Uint8Array(buffer));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'The document could not be opened.');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  return { bytes, error };
}

function PdfReader({ bytes }: { bytes: Uint8Array }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pages, setPages] = useState<string[]>([]);
  const [loadingText, setLoadingText] = useState(true);
  const [search, setSearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let loading: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    void import('pdfjs-dist/legacy/build/pdf.mjs')
      .then(({ GlobalWorkerOptions, getDocument }) => {
        if (cancelled) return undefined;
        GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loading = getDocument({
          data: bytes,
          disableAutoFetch: true,
          disableRange: true,
          disableStream: true,
          useSystemFonts: false,
          enableXfa: false,
        });
        return loading.promise;
      })
      .then(async (pdf) => {
        if (!pdf || cancelled) return;
        setDocument(pdf);
        setPageCount(pdf.numPages);
        const text: string[] = [];
        let size = 0;
        for (let index = 1; index <= Math.min(pdf.numPages, MAX_SEARCHABLE_PAGES); index += 1) {
          const page = await pdf.getPage(index);
          const content = await pageText(page);
          size += content.length;
          if (size > MAX_SEARCHABLE_TEXT) break;
          text.push(content);
          if (cancelled) break;
        }
        if (!cancelled) {
          setPages(text);
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
      void loading?.destroy().catch(() => undefined);
    };
  }, [bytes]);

  useEffect(() => {
    let cancelled = false;
    let rendering: ReturnType<PDFPageProxy['render']> | undefined;
    const canvas = canvasRef.current;
    if (!document || !canvas) return;
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1.25,
          2000 / unscaled.width,
          2600 / unscaled.height,
          Math.sqrt(4_000_000 / (unscaled.width * unscaled.height)),
        );
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        rendering = page.render({ canvas, canvasContext: context, viewport });
        return rendering.promise;
      })
      .catch(() => {
        if (!cancelled) setRenderError('This PDF page could not be rendered. The extracted text remains available.');
      });
    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [document, pageNumber]);

  const matchingPages = search.trim()
    ? pages.flatMap((text, index) =>
        text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? [index] : [],
      )
    : [];
  const currentMatch = matchingPages.length ? matchingPages[searchIndex % matchingPages.length] : undefined;

  return (
    <section aria-label="PDF document reader">
      <h3>
        Page {pageNumber} of {pageCount || '…'}
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
        {pages.length < pageCount && !loadingText ? ` Search covers the first ${pages.length} pages only.` : ''}
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
      <canvas ref={canvasRef} className="document-page-canvas" aria-hidden="true" />
      {renderError ? <p role="alert">{renderError}</p> : null}
      <section aria-label={`Accessible text for PDF page ${pageNumber}`} aria-live="polite">
        <h4>Page text</h4>
        <p>
          {pages[pageNumber - 1] || (loadingText ? 'Extracting text…' : 'No extractable text was found on this page.')}
        </p>
      </section>
    </section>
  );
}

function EpubReader({ bytes }: { bytes: Uint8Array }) {
  const [sections, setSections] = useState<SectionText[]>([]);
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
        const loaded: SectionText[] = [];
        let size = 0;
        for (const section of items) {
          const content = await section.load();
          const text = content.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          size += text.length;
          if (size > MAX_SEARCHABLE_TEXT) break;
          loaded.push({ title: section.href.split('/').at(-1) || `Section ${section.index + 1}`, text });
          if (cancelled) break;
        }
        if (!cancelled) setSections(loaded);
      })
      .catch(() => {
        if (!cancelled) setError('This ePub could not be opened. Use Open in external app to continue.');
      });
    return () => {
      cancelled = true;
      book?.destroy();
    };
  }, [bytes]);

  const matchingSections = search.trim()
    ? sections.flatMap((section, index) =>
        section.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? [index] : [],
      )
    : [];
  const activeSection = sections[sectionIndex];

  return (
    <section aria-label="ePub document reader">
      <h3>
        Section {sectionIndex + 1} of {sections.length || '…'}
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
          disabled={sectionIndex >= sections.length - 1}
          onClick={() => setSectionIndex((index) => Math.min(sections.length - 1, index + 1))}
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
          Go to {sections[index].title}
        </button>
      ))}
      {error ? (
        <p role="alert">{error}</p>
      ) : activeSection ? (
        <article aria-label={activeSection.title}>
          <h4>{activeSection.title}</h4>
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
    <p role="alert">{error}</p>
  ) : !bytes ? (
    <p role="status">Loading {kind.slice(1)} document…</p>
  ) : kind === '.pdf' ? (
    <PdfReader bytes={bytes} />
  ) : (
    <EpubReader bytes={bytes} />
  );
}
