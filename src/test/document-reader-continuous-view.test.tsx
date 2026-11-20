import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';
import type { NotebookBridge } from '../shared/bridge';

const { getDocument, ePub } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  ePub: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}));

vi.mock('epubjs/src/index.js', () => ({ default: ePub }));

function mockPdf(pageCount = 3) {
  return {
    numPages: pageCount,
    fingerprints: ['fixture-fingerprint', null],
    getPermissions: async (): Promise<number[] | null> => null,
    getPageLabels: async () => null,
    getMetadata: async () => ({ info: { Title: 'Test PDF' }, metadata: null }),
    getPage: vi.fn(async (pageNumber: number) => ({
      view: [0, 0, 100, 100],
      rotate: 0,
      getTextContent: async () => ({
        items: [
          {
            str: `Page ${pageNumber} searchable text`,
            dir: 'ltr',
            transform: [12, 0, 0, 12, 10, 90],
            width: 90,
            height: 12,
            fontName: 'test',
            hasEOL: false,
          },
        ],
      }),
      getStructTree: async () => null,
      getAnnotations: async () => [],
      getViewport: ({ scale = 1, rotation = 0 } = {}) => ({
        width: (rotation % 180 ? 100 : 100) * scale,
        height: 100 * scale,
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    })),
  };
}

describe('PDF continuous view toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      }),
    );
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) } });
    window.a11yNotebook = {
      vault: {
        listPdfAnnotations: vi.fn(async () => []),
        getPdfFormValues: vi.fn(async () => ({})),
      },
    } as unknown as NotebookBridge;
  });

  afterEach(() => {
    delete window.a11yNotebook;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openPdf(pageCount = 3) {
    const pdf = mockPdf(pageCount);
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn().mockResolvedValue(undefined) });
    render(<DocumentReader path="Docs/Guide.pdf" kind=".pdf" />);
    expect(await screen.findByText('Page 1 searchable text', {}, { timeout: 10000 })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.pdf-text-layer')).toBeInTheDocument(), {
      timeout: 10000,
    });
    return pdf;
  }

  function pageNavigationGroup() {
    return screen.getByRole('group', { name: 'PDF page navigation' });
  }

  /** The accessible page text, where each page's text appears once (the visual text layer holds a second copy). */
  function pageText() {
    return within(screen.getByLabelText(/Accessible text for PDF/));
  }

  it('places the toggle before Previous/Next, paginated by default with the pressed state exposed', async () => {
    await openPdf();
    const group = pageNavigationGroup();
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Paginated view',
      'Previous page',
      'Next page',
    ]);
    const toggle = screen.getByRole('button', { name: 'Paginated view' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Page 2 searchable text')).not.toBeInTheDocument();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('shows the whole document as one continuous page, then restores paginated navigation', async () => {
    await openPdf();
    fireEvent.click(screen.getByRole('button', { name: 'Paginated view' }));
    const toggle = await screen.findByRole('button', { name: 'Continuous view' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await pageText().findByText('Page 2 searchable text')).toBeInTheDocument();
    expect(pageText().getByText('Page 3 searchable text')).toBeInTheDocument();
    // Every page has a canvas and a text layer in continuous view.
    await waitFor(() => expect(document.querySelectorAll('canvas')).toHaveLength(3));
    expect(document.querySelectorAll('.pdf-text-layer')).toHaveLength(3);
    expect(document.querySelectorAll('[data-pdf-page]')).toHaveLength(6);
    // Notes keep working on the current page.
    expect(await screen.findByRole('button', { name: 'Create PDF note' })).toBeEnabled();

    fireEvent.click(toggle);
    expect(await screen.findByRole('button', { name: 'Paginated view' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(document.querySelectorAll('canvas')).toHaveLength(1));
    expect(screen.queryByText('Page 2 searchable text')).not.toBeInTheDocument();
    expect(pageText().getByText('Page 1 searchable text')).toBeInTheDocument();
  });

  it('moves the current page with Previous/Next in continuous view and restores it paginated', async () => {
    await openPdf();
    fireEvent.click(screen.getByRole('button', { name: 'Paginated view' }));
    await screen.findByRole('button', { name: 'Continuous view' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('heading', { name: 'Page 2 of 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('heading', { name: 'Page 3 of 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByRole('heading', { name: 'Page 2 of 3' })).toBeInTheDocument();

    // Switching back restores paginated navigation on the current page.
    fireEvent.click(screen.getByRole('button', { name: 'Continuous view' }));
    await screen.findByRole('button', { name: 'Paginated view' });
    await waitFor(() => expect(document.querySelectorAll('canvas')).toHaveLength(1));
    expect(pageText().getByText('Page 2 searchable text')).toBeInTheDocument();
    expect(screen.queryByText('Page 1 searchable text')).not.toBeInTheDocument();
    expect(screen.queryByText('Page 3 searchable text')).not.toBeInTheDocument();
  });
});
