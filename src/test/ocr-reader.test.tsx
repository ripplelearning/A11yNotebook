import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';
import type { OcrEngine } from '../renderer/features/previews/ocr-engine';
import type { NotebookBridge } from '../shared/bridge';

const { getDocument, ePub } = vi.hoisted(() => ({ getDocument: vi.fn(), ePub: vi.fn() }));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}));
vi.mock('epubjs/src/index.js', () => ({ default: ePub }));

function mockPdf() {
  return {
    numPages: 2,
    fingerprints: ['fixture-fingerprint', null],
    getPermissions: async () => null,
    getPageLabels: async () => null,
    getMetadata: async () => ({ info: { Title: 'Test PDF' }, metadata: null }),
    getPage: vi.fn(async () => ({
      view: [0, 0, 612, 792],
      rotate: 0,
      getTextContent: async () => ({ items: [] }),
      getStructTree: async () => null,
      getAnnotations: async () => [],
      getViewport: ({ scale = 1, rotation = 0 } = {}) => ({
        width: (rotation % 180 ? 792 : 612) * scale,
        height: (rotation % 180 ? 612 : 792) * scale,
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      renderCanvas: async () => document.createElement('canvas'),
    })),
  };
}

function mockEpubjs(sections: Array<{ href: string; text: string }>) {
  const display = vi.fn(async () => undefined);
  const rendition = {
    display,
    destroy: vi.fn(),
    attachTo: vi.fn((element: HTMLElement) => {
      element.appendChild(document.createElement('iframe'));
    }),
    on: vi.fn(),
    epubcfi: { isCfiString: () => false },
  };
  const Rendition = vi.fn(function MockRendition() {
    return rendition;
  });
  const epub = {
    open: vi.fn(async () => undefined),
    navigation: { toc: [] },
    book: {
      sections: {
        spineItems: sections.map(({ href, text }, index) => ({
          index,
          href,
          load: async () => ({ textContent: text }),
          hooks: { serialize: { register: () => undefined } },
        })),
        get: undefined,
      },
      manifest: { spine: sections.map(({ href }) => ({ href })) },
      destroy: vi.fn(),
    },
    resources: { resolve: (href: string) => href },
    destroy: vi.fn(),
  };
  (ePub as unknown as { Rendition: unknown; ViewManagers: unknown; Views: unknown }).Rendition = Rendition;
  (ePub as unknown as { ViewManagers: unknown }).ViewManagers = { default: class {} };
  (ePub as unknown as { Views: unknown }).Views = { iframe: class {} };
  ePub.mockResolvedValue(epub);
  return { display };
}

/** A real blank 2-page PDF, for the save path (pdf-lib re-reads the bytes). */
async function blankPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return doc.save();
}

/** A real 1-section image-only ePub: one chapter, one embedded picture, no text. */
async function imageOnlyEpubBytes(): Promise<Uint8Array> {
  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-book</dc:identifier><dc:title>Test Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="img1.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/></spine></package>',
  );
  zip.file(
    'OEBPS/ch1.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><p><img src="img1.png" alt=""/></p></body></html>',
  );
  zip.file('OEBPS/img1.png', Uint8Array.from(atob(pixel), (char) => char.charCodeAt(0)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function fakeEngineFactory(text = 'HELLO'): (language: string) => Promise<OcrEngine> {
  return async () => ({
    recognize: async () => ({ text, words: [] }),
    terminate: vi.fn(async () => undefined),
  });
}

async function runOcrInDialog() {
  // The reader shows the OCR action twice (view controls and the empty state); both open the same dialog.
  fireEvent.click(screen.getAllByRole('button', { name: 'OCR this file' })[0]);
  await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument(), {
    timeout: 10000,
  });
  fireEvent.click(screen.getByRole('radio', { name: /English/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Start OCR' }));
  await waitFor(
    () => expect(screen.getByText(/Recognized text \(temporary\)/)).toBeInTheDocument(),
    { timeout: 10000 },
  );
}

describe('OCR in the document reader', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let saveOcrText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.stubGlobal('fetch', fetchMock);
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({}),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    saveOcrText = vi.fn(async () => ({
      path: 'Docs/ImageOnly.pdf',
      name: 'ImageOnly.pdf',
      copied: false,
    }));
    window.a11yNotebook = {
      getPdfReadingPreferences: vi.fn(async () => ({
        hideHeadersFooters: false,
        hidePageNumbers: false,
        continuousView: true,
      })),
      setPdfReadingPreferences: vi.fn(async (value: unknown) => value),
      vault: {
        listPdfAnnotations: vi.fn(async () => []),
        getPdfFormValues: vi.fn(async () => ({})),
        savePdfFormValues: vi.fn(async () => undefined),
        listEpubAnnotations: vi.fn(async () => []),
        getReadingPosition: vi.fn(async () => null),
        setReadingPosition: vi.fn(async () => undefined),
        listOcrLanguages: vi.fn(async () => [{ code: 'eng', name: 'English', ready: true }]),
        ensureOcrLanguage: vi.fn(async () => ({ ready: true, downloaded: false })),
        saveOcrText,
      },
    } as unknown as NotebookBridge;
    vi.stubGlobal(
      'URL',
      class {
        static createObjectURL() {
          return 'blob:test';
        }
        static revokeObjectURL() {}
      },
    );
    getDocument.mockReset();
    getDocument.mockImplementation(() => ({
      promise: Promise.resolve(mockPdf()),
      destroy: vi.fn(async () => undefined),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.a11yNotebook;
  });

  it('shows OCR text temporarily in a PDF, then Ctrl+S saves it into the file', async () => {
    const bytes = await blankPdfBytes();
    fetchMock.mockImplementation(async () => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer }));
    const ocrSaveRef: { current: (() => Promise<void>) | null } = { current: null };
    render(
      <DocumentReader
        path="Docs/ImageOnly.pdf"
        kind=".pdf"
        ocrSaveRef={ocrSaveRef}
        ocrEngineFactory={fakeEngineFactory()}
      />,
    );
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: 'OCR this file' })[0]).toBeInTheDocument(),
      { timeout: 10000 },
    );
    // This test counts the temporary text on one page, so read in
    // Paginated view; Continuous view would show both pages' text.
    fireEvent.click(screen.getByRole('radio', { name: 'Paginated view' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Paginated view' })).toBeChecked());
    await runOcrInDialog();
    // The text shows in the page text and again in the semantic DOM paragraph.
    expect(screen.getAllByText('HELLO')).toHaveLength(2);
    expect(screen.getByText(/Press Ctrl\+S to save it into the file\./)).toBeInTheDocument();
    expect(ocrSaveRef.current).toBeTypeOf('function');

    await ocrSaveRef.current!();
    await waitFor(() =>
      expect(
        screen.getByText(/OCR text saved into the file\./),
      ).toBeInTheDocument(),
    );
    expect(saveOcrText).toHaveBeenCalledTimes(1);
    const [savedPath, savedKind, savedBytes] = saveOcrText.mock.calls[0] as [string, string, Uint8Array];
    expect(savedPath).toBe('Docs/ImageOnly.pdf');
    expect(savedKind).toBe('.pdf');
    expect(savedBytes.length).toBeGreaterThan(bytes.length);
    // The temporary text is cleared once the file holds it.
    expect(screen.queryByText(/Recognized text \(temporary\)/)).not.toBeInTheDocument();
  });

  it('keeps the temporary text after saving an Alius copy, and never touches the original', async () => {
    const bytes = await imageOnlyEpubBytes();
    fetchMock.mockImplementation(async () => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer }));
    mockEpubjs([{ href: 'OEBPS/ch1.xhtml', text: '' }]);
    saveOcrText.mockResolvedValue({
      path: 'Docs/Book (OCR).epub',
      name: 'Book (OCR).epub',
      copied: true,
    });
    const ocrSaveRef: { current: (() => Promise<void>) | null } = { current: null };
    render(
      <DocumentReader
        path="Docs/Book.epub.alius"
        kind=".epub"
        ocrSaveRef={ocrSaveRef}
        ocrEngineFactory={fakeEngineFactory()}
      />,
    );
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: 'OCR this file' })[0]).toBeInTheDocument(),
      { timeout: 10000 },
    );
    await runOcrInDialog();
    expect(screen.getByText('HELLO')).toBeInTheDocument();

    await ocrSaveRef.current!();
    await waitFor(() =>
      expect(
        screen.getByText(/Saved OCR copy as Book \(OCR\)\.epub\. The original file was not changed\./),
      ).toBeInTheDocument(),
    );
    expect(saveOcrText).toHaveBeenCalledTimes(1);
    const [savedPath, savedKind, savedBytes] = saveOcrText.mock.calls[0] as [string, string, Uint8Array];
    expect(savedPath).toBe('Docs/Book.epub.alius');
    expect(savedKind).toBe('.epub');
    // The copy actually carries the recognized text.
    const copy = await new JSZip().loadAsync(savedBytes);
    expect(await copy.file('OEBPS/ch1.xhtml')?.async('string')).toContain('HELLO');
    // And the reader keeps the temporary text because the open file was not changed.
    expect(screen.getByText('HELLO')).toBeInTheDocument();
    expect(screen.getByText(/Recognized text \(temporary\)/)).toBeInTheDocument();
  });
});
