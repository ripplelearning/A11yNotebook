import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';

const { getDocument, ePub } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  ePub: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}));

vi.mock('epubjs/src/index.js', () => ({ default: ePub }));

function mockPdf() {
  return {
    numPages: 2,
    fingerprints: ['fixture-fingerprint', null],
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

describe('local accessible document reader', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses pdf.js for page text, navigation, and in-document search', async () => {
    const pdf = mockPdf();
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn().mockResolvedValue(undefined) });
    render(<DocumentReader path="Docs/Guide.pdf" kind=".pdf" />);

    expect(await screen.findByText('Page 1 searchable text')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.pdf-text-layer')).toBeInTheDocument());
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ disableAutoFetch: true, disableRange: true, disableStream: true, enableXfa: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 searchable text')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Find in PDF' }), { target: { value: 'searchable' } });
    expect(await screen.findByRole('button', { name: 'Next search result (1 of 2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(await screen.findByLabelText('PDF zoom')).toHaveTextContent('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate page' }));
    await waitFor(() => expect(document.querySelector('.pdf-text-layer')).toHaveAttribute('data-rotation', '90'));
  });

  it('uses epub.js for section navigation and search', async () => {
    const book = {
      spine: {
        spineItems: [
          { index: 0, href: 'Text/one.xhtml', load: async () => ({ textContent: 'First chapter text' }) },
          { index: 1, href: 'Text/two.xhtml', load: async () => ({ textContent: 'Second chapter text' }) },
        ],
      },
      destroy: vi.fn(),
    };
    ePub.mockResolvedValue(book);
    render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);

    expect(await screen.findByText('First chapter text')).toBeInTheDocument();
    expect(ePub).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    fireEvent.click(screen.getByRole('button', { name: 'Next section' }));
    expect(await screen.findByText('Second chapter text')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Find in ePub' }), { target: { value: 'second' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to two.xhtml' })).toBeInTheDocument());
  });

  it('rejects an oversized file before passing it to a parser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(40 * 1024 * 1024 + 1),
      }),
    );
    render(<DocumentReader path="Docs/Huge.pdf" kind=".pdf" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('too large');
    expect(getDocument).not.toHaveBeenCalled();
  });
});
