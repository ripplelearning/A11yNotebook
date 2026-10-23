import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';
import type { NotebookBridge } from '../shared/bridge';

const fake = vi.hoisted(() => ({
  numPages: 600,
  destroyCalls: 0,
  preferences: {
    colorScheme: 'dark',
    lineHeight: 1.6,
    letterSpacing: 0,
    wordSpacing: 0,
    margin: 5,
    hideImages: false,
    showArtifacts: false,
  } as never,
}));

vi.mock('../renderer/hooks/usePdfReadingPreferences', () => ({
  usePdfReadingPreferences: () => fake.preferences,
}));

vi.mock('../renderer/pdf-semantic', () => ({
  applyPdfReadingPreferences: vi.fn(),
  PdfDocument: class {
    ready = Promise.resolve();
    numPages = fake.numPages;
    getPage = async (pageNum: number) => ({
      pageNum,
      label: `Page ${pageNum}`,
      canRotate: 0,
      view: [0, 0, 612, 792],
      textModel: { fullText: 'word', items: [{ startOffset: 0, endOffset: 4 }], findText: () => [] },
      viewportTransform: (_scale: number, rotation: number) => ({ rotation }),
      renderCanvas: async () => document.createElement('canvas'),
      getTextLayer: () => {
        const layer = document.createElement('div');
        layer.innerHTML = '<span data-start-offset="0" data-end-offset="4">word</span>';
        return layer;
      },
      getSemanticDOM: () => {
        const article = document.createElement('article');
        article.innerHTML = '<p><span data-start-offset="0" data-end-offset="4">word</span></p>';
        return article;
      },
      highlightAtAnchor: () => [0, 0, 10, 10],
      createAnnotationAnchor: vi.fn(),
      selectTextRange: vi.fn(),
    });
    classifyUntaggedPages = async () => undefined;
    setReadingPreferences = vi.fn();
    destroy = async () => {
      fake.destroyCalls += 1;
    };
    resolveAnnotationAnchor = async () => ({
      offset: 0,
      length: 4,
      page: 1,
      classification: 'exact',
      confidence: 'certain',
      verification: 'verified',
      reason: 'Exact quote.',
    });
  },
}));

beforeEach(() => {
  fake.numPages = 600;
  fake.destroyCalls = 0;
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array([3]).buffer } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })),
  );
  window.a11yNotebook = {
    vault: {
      readAttachment: vi.fn(async () => new Uint8Array([1, 2])),
      listPdfAnnotations: vi.fn(async () => []),
    },
  } as unknown as NotebookBridge;
});

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
  vi.unstubAllGlobals();
});

describe('PDF Phase 7 validation: caps and lifecycle', () => {
  it('caps searchable extraction at 500 pages and says so', async () => {
    render(<DocumentReader path="Docs/Big.pdf" kind=".pdf" />);
    expect(await screen.findByText(/Search covers the first 500 pages only/)).toBeInTheDocument();
    const search = screen.getByLabelText(/Find in PDF/);
    fireEvent.change(search, { target: { value: 'word' } });
    expect(await screen.findByText(/500 matching pages/)).toBeInTheDocument();
  });

  it('destroys the pdf.js document when the reader unmounts', async () => {
    const view = render(<DocumentReader path="Docs/Big.pdf" kind=".pdf" />);
    await screen.findByText(/Search covers the first 500 pages only/);
    view.unmount();
    await waitFor(() => expect(fake.destroyCalls).toBeGreaterThanOrEqual(1));
  });

  it('refuses a document over the 40 MB preview cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(41 * 1024 * 1024) })),
    );
    (
      window.a11yNotebook!.vault as unknown as { readAttachment: ReturnType<typeof vi.fn> }
    ).readAttachment.mockResolvedValue(new Uint8Array(41 * 1024 * 1024));
    render(<DocumentReader path="Docs/Huge.pdf" kind=".pdf" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('too large to preview');
  });
});
