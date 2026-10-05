import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { NotebookBridge } from '../shared/bridge';
import { getSelectionOffsets, selectTextRange } from '../renderer/pdf-semantic/text-layer';

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
    delete window.a11yNotebook;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applies saved PDF preferences live to every reader without rebuilding selection layers', async () => {
    let stored = { hideHeadersFooters: false, hidePageNumbers: false };
    const getPreferences = vi.fn(async () => stored);
    const savePreferences = vi.fn(async (value: typeof stored) => (stored = value));
    window.a11yNotebook = {
      vault: { listPdfAnnotations: vi.fn(async () => []) },
      getPdfReadingPreferences: getPreferences,
      setPdfReadingPreferences: savePreferences,
    } as unknown as NotebookBridge;
    const pdf = mockPdf();
    pdf.numPages = 3;
    const originalGetPage = pdf.getPage;
    pdf.getPage = vi.fn(async (pageNumber: number) => ({
      ...(await originalGetPage(pageNumber)),
      getTextContent: async () => ({
        items: [
          { str: 'Running title', transform: [10, 0, 0, 10, 10, 96], hasEOL: true },
          { str: 'Body text remains searchable', transform: [10, 0, 0, 10, 10, 50], hasEOL: true },
          { str: `${pageNumber}`, transform: [10, 0, 0, 10, 10, 3], hasEOL: false },
        ].map((item) => ({ ...item, dir: 'ltr', width: 80, height: 10, fontName: 'test' })),
      }),
    }));
    getDocument.mockImplementation(() => ({
      promise: Promise.resolve(pdf),
      destroy: vi.fn().mockResolvedValue(undefined),
    }));
    const readers = render(
      <>
        <DocumentReader path="Docs/One.pdf" kind=".pdf" />
        <DocumentReader path="Docs/Two.pdf" kind=".pdf" />
      </>,
    );
    await waitFor(() => expect(document.querySelectorAll('.pdf-text-layer')).toHaveLength(2));
    const layers = [...document.querySelectorAll<HTMLElement>('.pdf-text-layer')];
    const canvases = [...document.querySelectorAll('canvas')];
    const headers = [...document.querySelectorAll('[data-pdf-artifact-type="header"]')];
    const numbers = [...document.querySelectorAll('[data-pdf-artifact-type="page-number"]')];
    expect(headers.length).toBeGreaterThanOrEqual(4);
    expect(numbers.length).toBeGreaterThanOrEqual(4);
    expect(headers.every((node) => !node.hasAttribute('aria-hidden'))).toBe(true);
    const pageLoads = pdf.getPage.mock.calls.length;
    const settings = render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />);
    const toggle = screen.getByRole('checkbox', { name: 'Hide running headers/footers from assistive technology' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(selectTextRange(layers[0], 0, 'Running title'.length)).toBe(true);
    const selection = getSelectionOffsets(layers[0]);
    fireEvent.click(toggle);
    await waitFor(() => expect(headers.every((node) => node.getAttribute('aria-hidden') === 'true')).toBe(true));
    expect(headers.every((node) => !node.hasAttribute('hidden'))).toBe(true);
    expect(numbers.every((node) => !node.hasAttribute('aria-hidden'))).toBe(true);
    expect(getSelectionOffsets(layers[0])).toEqual(selection);
    expect(document.getSelection()?.toString()).toBe('Running title');
    expect([...document.querySelectorAll('.pdf-text-layer')]).toEqual(layers);
    expect([...document.querySelectorAll('canvas')]).toEqual(canvases);
    expect(pdf.getPage.mock.calls).toHaveLength(pageLoads);
    expect(getDocument).toHaveBeenCalledTimes(2);
    settings.unmount();

    fireEvent.change(screen.getAllByRole('textbox', { name: 'Find in PDF' })[0], {
      target: { value: 'Running title' },
    });
    expect(await screen.findByRole('button', { name: 'Next search result (1 of 3)' })).toBeInTheDocument();
    expect(readers.container.textContent).toContain('Running title');
    stored = { hideHeadersFooters: false, hidePageNumbers: true };
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(numbers.every((node) => node.getAttribute('aria-hidden') === 'true')).toBe(true));
    expect(headers.every((node) => !node.hasAttribute('aria-hidden'))).toBe(true);
    expect([...document.querySelectorAll('.pdf-text-layer')]).toEqual(layers);
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
