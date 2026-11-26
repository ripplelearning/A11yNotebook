import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';
import type { NotebookBridge } from '../shared/bridge';
import type { PdfReadingPreferences } from '../shared/pdf-reading-preferences';

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

describe('PDF continuous view is the default', () => {
  let stored: PdfReadingPreferences;
  let getPreferences: ReturnType<typeof vi.fn>;
  let savePreferences: ReturnType<typeof vi.fn>;

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
    stored = { hideHeadersFooters: false, hidePageNumbers: false, continuousView: true };
    getPreferences = vi.fn(async () => stored);
    savePreferences = vi.fn(async (value: PdfReadingPreferences) => {
      stored = value;
      return stored;
    });
    window.a11yNotebook = {
      vault: {
        listPdfAnnotations: vi.fn(async () => []),
        getPdfFormValues: vi.fn(async () => ({})),
      },
      getPdfReadingPreferences: getPreferences,
      setPdfReadingPreferences: savePreferences,
    } as unknown as NotebookBridge;
  });

  afterEach(() => {
    cleanup();
    delete window.a11yNotebook;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openPdf(pageCount = 3) {
    const pdf = mockPdf(pageCount);
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn().mockResolvedValue(undefined) });
    const view = render(<DocumentReader path="Docs/Guide.pdf" kind=".pdf" />);
    expect(await screen.findByText('Page 1 searchable text', {}, { timeout: 10000 })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.pdf-text-layer')).toBeInTheDocument(), {
      timeout: 10000,
    });
    return { pdf, view };
  }

  /** The accessible page text, where each page's text appears once (the visual text layer holds a second copy). */
  function pageText() {
    return within(screen.getByLabelText(/Accessible text for PDF/));
  }

  /** Exactly one view is active at all times: one radio checked, the other unchecked. */
  function expectExactlyOneViewChecked(paginatedChecked: boolean) {
    const paginated = screen.getByRole('radio', { name: 'Paginated view' });
    const continuous = screen.getByRole('radio', { name: 'Continuous view' });
    if (paginatedChecked) {
      expect(paginated).toBeChecked();
      expect(continuous).not.toBeChecked();
    } else {
      expect(paginated).not.toBeChecked();
      expect(continuous).toBeChecked();
    }
  }

  it('opens a PDF in Continuous view by default, showing the whole document', async () => {
    await openPdf();
    expectExactlyOneViewChecked(false);
    expect(await pageText().findByText('Page 2 searchable text')).toBeInTheDocument();
    expect(pageText().getByText('Page 3 searchable text')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('canvas')).toHaveLength(3));
  });

  it('opens a PDF in Paginated view when that choice was saved', async () => {
    stored = { hideHeadersFooters: false, hidePageNumbers: false, continuousView: false };
    await openPdf();
    await waitFor(() => expectExactlyOneViewChecked(true));
    expect(screen.queryByText('Page 2 searchable text')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('canvas')).toHaveLength(1));
  });

  it('follows a saved Paginated choice that loads after the reader opens', async () => {
    let resolvePreferences: (value: PdfReadingPreferences) => void = () => undefined;
    getPreferences.mockImplementationOnce(
      () =>
        new Promise<PdfReadingPreferences>((resolve) => {
          resolvePreferences = resolve;
        }),
    );
    await openPdf();
    // Before the saved choice loads, the reader opens in the default view.
    expectExactlyOneViewChecked(false);
    resolvePreferences({ hideHeadersFooters: false, hidePageNumbers: false, continuousView: false });
    await waitFor(() => expectExactlyOneViewChecked(true));
    expect(screen.queryByText('Page 2 searchable text')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
  });

  it('remembers a switch to Paginated for the next PDF, and a switch back to Continuous', async () => {
    const first = await openPdf();
    fireEvent.click(screen.getByRole('radio', { name: 'Paginated view' }));
    expectExactlyOneViewChecked(true);
    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith({
        hideHeadersFooters: false,
        hidePageNumbers: false,
        continuousView: false,
      }),
    );

    // A freshly opened PDF starts in the remembered view.
    first.view.unmount();
    await openPdf();
    await waitFor(() => expectExactlyOneViewChecked(true));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();

    // Switching back to Continuous is remembered the same way.
    fireEvent.click(screen.getByRole('radio', { name: 'Continuous view' }));
    expectExactlyOneViewChecked(false);
    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith({
        hideHeadersFooters: false,
        hidePageNumbers: false,
        continuousView: true,
      }),
    );
    expect(savePreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({ hideHeadersFooters: true }),
    );
  });
});
