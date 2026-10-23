import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PdfNotes from '../renderer/features/previews/PdfNotes';
import type { PdfDocument, PdfPage } from '../renderer/pdf-semantic';
import type { NotebookBridge } from '../shared/bridge';
import type { PdfAnnotationTarget } from '../shared/pdf-annotation';

const target: PdfAnnotationTarget = {
  kind: 'pdf',
  documentIdentity: { fingerprint: 'fp', fileHash: 'hash', vaultPath: 'book.pdf' },
  page: 1,
  canonicalStart: 0,
  canonicalLength: 5,
  exactQuote: 'Hello',
  normalizedQuote: 'Hello',
  contextBefore: '',
  contextAfter: '',
  classification: 'exact',
  confidence: 'certain',
  verification: 'verified',
  manuallyConfirmed: false,
};

const PAGE_TEXTS: Record<number, string> = {
  1: 'Alpha bravo charlie',
  2: 'Delta echo foxtrot',
  3: 'Golf hotel india',
};

function makePage(pageNum: number): PdfPage {
  const text = PAGE_TEXTS[pageNum];
  return {
    pageNum,
    textModel: {
      fullText: text,
      items: [{ startOffset: 0, endOffset: text.length }],
      findText: vi.fn(() => []),
    },
    createAnnotationAnchor: vi.fn((start: number, length: number) => ({
      ...target,
      page: pageNum,
      canonicalStart: start,
      canonicalLength: length,
      exactQuote: text.slice(start, start + length),
      normalizedQuote: text.slice(start, start + length),
    })),
    highlightAtAnchor: vi.fn(() => [0, 0, 10, 10]),
  } as unknown as PdfPage;
}

function setup() {
  const pages = new Map<number, PdfPage>();
  const pdf = {
    getPage: vi.fn(async (pageNum: number) => {
      if (!pages.has(pageNum)) pages.set(pageNum, makePage(pageNum));
      return pages.get(pageNum)!;
    }),
    resolveAnnotationAnchor: vi.fn(async (anchor: PdfAnnotationTarget) => ({
      offset: anchor.canonicalStart,
      length: anchor.canonicalLength,
      page: anchor.page,
      classification: anchor.classification,
      confidence: anchor.confidence,
      verification: 'verified' as const,
      reason: 'Exact canonical quote.',
    })),
  } as unknown as PdfDocument;
  const api = {
    listPdfAnnotations: vi.fn(async () => []),
    addPdfAnnotation: vi.fn(async (input: unknown) => ({
      id: 'note-x',
      path: 'book.pdf',
      label: 'Span',
      comment: '',
      color: 'yellow',
      createdAt: '2026-10-05T00:00:00Z',
      modifiedAt: '2026-10-05T00:00:00Z',
      schemaVersion: 1,
      ...(input as object),
    })),
    updatePdfAnnotation: vi.fn(),
    deletePdfAnnotation: vi.fn(async () => undefined),
  };
  window.a11yNotebook = { vault: api } as unknown as NotebookBridge;
  return { api, pdf, pages };
}

function Harness({ pdf }: { pdf: PdfDocument }) {
  const readerRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const semanticRef = useRef<HTMLDivElement>(null);
  const [pageNum, setPageNum] = useState(1);
  const [page, setPage] = useState<PdfPage | null>(null);
  const text = PAGE_TEXTS[pageNum];
  return (
    <section ref={readerRef} data-context="pdf-selection">
      <button
        type="button"
        onClick={() => {
          const next = pageNum + 1;
          setPageNum(next);
          void pdf.getPage(next).then(setPage);
        }}
      >
        Turn page
      </button>
      <button
        type="button"
        onClick={() => {
          void pdf.getPage(1).then(setPage);
        }}
      >
        Load page
      </button>
      <div ref={visualRef}>
        <span data-start-offset="0" data-end-offset={text.length}>
          {text}
        </span>
      </div>
      <div ref={semanticRef}>
        <p tabIndex={0}>
          <span data-start-offset="0" data-end-offset={text.length}>
            {text}
          </span>
        </p>
      </div>
      {page ? (
        <PdfNotes
          document={pdf}
          path="book.pdf"
          loadedPages={3}
          readerRef={readerRef}
          visualRef={visualRef}
          semanticRef={semanticRef}
          rendered={{ page, scale: 1, rotation: 0 }}
          onNavigate={vi.fn()}
        />
      ) : null}
    </section>
  );
}

function selectText(container: HTMLElement, text: string, from: number, to: number) {
  const span = [...container.querySelectorAll('span')].find((item) => item.textContent === text)!;
  const range = document.createRange();
  range.setStart(span.firstChild!, from);
  range.setEnd(span.firstChild!, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

describe('cross-page PDF notes', () => {
  it('builds one grouped note spanning the start page, whole middle pages, and the end page', async () => {
    const { api, pdf } = setup();
    const { container } = render(<Harness pdf={pdf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load page' }));
    await screen.findByRole('button', { name: 'Start cross-page note' });
    // Start inside page 1 at offset 6 ("bravo charlie" remains).
    selectText(container, PAGE_TEXTS[1], 6, 11);
    fireEvent.click(screen.getByRole('button', { name: 'Start cross-page note' }));
    expect(await screen.findByText(/Note selection started on page 1/)).toBeInTheDocument();
    // Turn to page 2, then page 3, and finish with a selection there.
    fireEvent.click(screen.getByRole('button', { name: 'Turn page' }));
    await waitFor(() => expect(container.querySelector('[data-start-offset]')?.textContent).toBe(PAGE_TEXTS[2]));
    fireEvent.click(screen.getByRole('button', { name: 'Turn page' }));
    await waitFor(() => expect(container.querySelector('[data-start-offset]')?.textContent).toBe(PAGE_TEXTS[3]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish cross-page note on this page' })).toBeEnabled());
    selectText(container, PAGE_TEXTS[3], 0, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Finish cross-page note on this page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label (optional)' }), { target: { value: 'Span' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addPdfAnnotation).toHaveBeenCalled());
    const input = api.addPdfAnnotation.mock.calls[0][0] as {
      target: PdfAnnotationTarget;
      targets?: PdfAnnotationTarget[];
    };
    const all = [input.target, ...(input.targets ?? [])];
    expect(all.map((item) => [item.page, item.canonicalStart, item.canonicalLength])).toEqual([
      [1, 6, PAGE_TEXTS[1].length - 6],
      [2, 0, PAGE_TEXTS[2].length],
      [3, 0, 4],
    ]);
  });

  it('refuses to finish before a starting selection exists and allows cancelling', async () => {
    const { pdf } = setup();
    const { container } = render(<Harness pdf={pdf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load page' }));
    await screen.findByRole('button', { name: 'Start cross-page note' });
    fireEvent.click(screen.getByRole('button', { name: 'Start cross-page note' }));
    expect(await screen.findByText(/Select the first words of the passage/)).toBeInTheDocument();
    selectText(container, PAGE_TEXTS[1], 0, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Start cross-page note' }));
    expect(await screen.findByText(/Note selection started on page 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel cross-page note' }));
    expect(await screen.findByRole('button', { name: 'Start cross-page note' })).toBeInTheDocument();
  });
});
