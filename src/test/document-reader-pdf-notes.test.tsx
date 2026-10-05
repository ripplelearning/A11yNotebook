import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotebookBridge } from '../shared/bridge';
import type { PdfAnnotationTarget } from '../shared/pdf-annotation';
import DocumentReader from '../renderer/features/previews/DocumentReader';

const fake = vi.hoisted(() => ({
  canvas: vi.fn(),
  textLayer: vi.fn(),
  semantic: vi.fn(),
  highlight: vi.fn(),
  anchor: vi.fn(),
  preferences: { hideHeadersFooters: false, hidePageNumbers: false },
}));

vi.mock('../renderer/hooks/usePdfReadingPreferences', () => ({
  usePdfReadingPreferences: () => fake.preferences,
}));

vi.mock('../renderer/pdf-semantic', () => {
  const page = {
    pageNum: 1,
    label: 'Page 1',
    canRotate: 0,
    view: [0, 0, 4000, 6000],
    textModel: { fullText: 'Hello PDF', items: [{ startOffset: 0, endOffset: 9 }], findText: () => [] },
    viewportTransform: (_scale: number, rotation: number) => ({ rotation }),
    renderCanvas: fake.canvas,
    getTextLayer: fake.textLayer,
    getSemanticDOM: fake.semantic,
    highlightAtAnchor: fake.highlight,
    createAnnotationAnchor: fake.anchor,
    selectTextRange: vi.fn(),
  };
  return {
    applyPdfReadingPreferences: vi.fn(),
    PdfDocument: class {
      ready = Promise.resolve();
      numPages = 1;
      getPage = async () => page;
      classifyUntaggedPages = async () => undefined;
      setReadingPreferences = vi.fn();
      destroy = async () => undefined;
      resolveAnnotationAnchor = async () => ({
        offset: 0,
        length: 5,
        page: 1,
        classification: 'exact',
        confidence: 'certain',
        verification: 'verified',
        reason: 'Exact quote.',
      });
    },
  };
});

const target: PdfAnnotationTarget = {
  kind: 'pdf',
  documentIdentity: { fingerprint: 'fp', fileHash: 'hash', vaultPath: 'book.pdf' },
  page: 1,
  canonicalStart: 0,
  canonicalLength: 5,
  exactQuote: 'Hello',
  normalizedQuote: 'hello',
  contextBefore: '',
  contextAfter: ' pdf',
  classification: 'exact',
  confidence: 'certain',
  verification: 'verified',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })),
  );
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array([3]).buffer } });
  fake.canvas.mockImplementation(async () => document.createElement('canvas'));
  fake.textLayer.mockImplementation(() => {
    const layer = document.createElement('div');
    layer.className = 'pdf-text-layer';
    layer.innerHTML = '<span data-start-offset="0" data-end-offset="9">Hello PDF</span>';
    return layer;
  });
  fake.semantic.mockImplementation(() => {
    const article = document.createElement('article');
    article.innerHTML = '<p><span data-start-offset="0" data-end-offset="9">Hello PDF</span></p>';
    return article;
  });
  fake.highlight.mockImplementation((_start, _length, scale) => [10 * scale, 20 * scale, 50 * scale, 10 * scale]);
  fake.anchor.mockImplementation((start, length) => ({ ...target, canonicalStart: start, canonicalLength: length }));
  window.a11yNotebook = {
    vault: {
      listPdfAnnotations: vi.fn(async () => [
        {
          id: 'one',
          path: 'book.pdf',
          target,
          label: 'Highlight',
          comment: '',
          color: 'yellow',
          schemaVersion: 1,
          createdAt: '2026-10-05',
          modifiedAt: '2026-10-05',
        },
      ]),
    },
  } as unknown as NotebookBridge;
});

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('PDF reader annotation rendering', () => {
  it('does not make running artifacts interactive and defeat reading-preference hiding', async () => {
    fake.semantic.mockImplementationOnce(() => {
      const article = document.createElement('article');
      article.innerHTML =
        '<p data-pdf-artifact-type="header"><span data-start-offset="0" data-end-offset="5">Hello</span></p><p><span data-start-offset="5" data-end-offset="9"> PDF</span></p>';
      return article;
    });
    const view = render(<DocumentReader path="book.pdf" kind=".pdf" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    const header = view.container.querySelector('[data-pdf-artifact-type="header"]');
    expect(header).not.toHaveAttribute('tabindex');
    expect(header).not.toHaveAttribute('data-context');
    expect(view.container.querySelector('[data-context="pdf-semantic"]')).toHaveTextContent('PDF');
  });

  it('shares the actual canvas safety-capped scale with highlights at every zoom and rotation', async () => {
    const view = render(<DocumentReader path="book.pdf" kind=".pdf" />);
    const scale = Math.sqrt(4_000_000 / (4000 * 6000));
    await waitFor(() => expect(view.container.querySelector('.pdf-note-highlight')).not.toBeNull());
    expect(fake.canvas).toHaveBeenLastCalledWith(scale, 0);
    expect(fake.highlight).toHaveBeenLastCalledWith(0, 5, scale, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(fake.highlight).toHaveBeenLastCalledWith(0, 5, scale, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate page' }));
    await waitFor(() => expect(fake.highlight).toHaveBeenLastCalledWith(0, 5, 2000 / 6000, 90));
    expect(target.canonicalStart).toBe(0);
    expect(view.container.querySelectorAll('.pdf-note-overlay')).toHaveLength(1);
  });

  it('exposes semantic text only once and supports scoped annotation of a keyboard-focused paragraph', async () => {
    const view = render(<DocumentReader path="book.pdf" kind=".pdf" />);
    await screen.findByRole('button', { name: 'Create PDF note' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    expect(screen.getByRole('region', { name: 'PDF document reader' })).toHaveAttribute(
      'data-context',
      'pdf-selection',
    );
    expect(view.container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(view.container.querySelector('.pdf-text-layer')).toHaveAttribute('aria-hidden', 'true');
    const paragraph = view.container.querySelector('[aria-label="Accessible text for PDF page 1"] p') as HTMLElement;
    expect(paragraph).toHaveAttribute('tabindex', '0');
    expect(paragraph).toHaveAttribute('data-context', 'pdf-semantic');
    paragraph.focus();
    act(() => window.dispatchEvent(new CustomEvent('annotate-current-semantic-element')));
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(fake.anchor).toHaveBeenCalledWith(0, 9);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(paragraph).toHaveFocus();
  });
});
