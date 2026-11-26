import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotebookBridge } from '../shared/bridge';
import DocumentReader, { type PdfBookmarkApi } from '../renderer/features/previews/DocumentReader';
import { selectTextRange } from '../renderer/pdf-semantic/text-layer';

// jsdom does not implement scrollIntoView; the reader only needs the call
// to be harmless, so stub it once for this file.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

const fake = vi.hoisted(() => ({
  canvas: vi.fn(),
  textLayer: vi.fn(),
  preferences: { hideHeadersFooters: false, hidePageNumbers: false, continuousView: true },
}));

vi.mock('../renderer/hooks/usePdfReadingPreferences', () => ({
  usePdfReadingPreferences: () => fake.preferences,
  savePdfReadingPreferences: vi.fn(async () => undefined),
}));

/**
 * A three-page PDF: page 1 has one paragraph, page 2 has two, page 3
 * has no extractable text. Spans carry the same offsets the real
 * semantic DOM carries, so the spot math is exercised for real.
 */
function semanticForPage(page: number): HTMLElement {
  const article = document.createElement('article');
  if (page === 1) {
    article.innerHTML =
      '<p><span data-start-offset="0" data-end-offset="6">Alpha </span>' +
      '<span data-start-offset="6" data-end-offset="11">beta </span>' +
      '<span data-start-offset="11" data-end-offset="16">gamma</span></p>';
  } else if (page === 2) {
    article.innerHTML =
      '<p><span data-start-offset="0" data-end-offset="6">Delta </span>' +
      '<span data-start-offset="6" data-end-offset="13">epsilon</span></p>' +
      '<p><span data-start-offset="13" data-end-offset="18">Zeta </span>' +
      '<span data-start-offset="18" data-end-offset="21">eta</span></p>';
  }
  return article;
}

const pageTexts = ['', '', ''];
pageTexts[0] = 'Alpha beta gamma';
pageTexts[1] = 'Delta epsilonZeta eta';
pageTexts[2] = '';

vi.mock('../renderer/pdf-semantic', () => {
  const makePage = (pageNum: number) => ({
    pageNum,
    label: `Page ${pageNum}`,
    canRotate: 0,
    view: [0, 0, 612, 792],
    textModel: { fullText: pageTexts[pageNum - 1], items: [], findText: () => [] },
    viewportTransform: (_scale: number, rotation: number) => ({ rotation }),
    renderCanvas: fake.canvas,
    getTextLayer: fake.textLayer,
    getSemanticDOM: () => semanticForPage(pageNum),
    highlightAtAnchor: vi.fn(() => [0, 0, 10, 10]),
    createAnnotationAnchor: vi.fn(),
    selectTextRange: (startOffset: number, length: number, layer?: HTMLElement) =>
      selectTextRange(layer ?? document.createElement('div'), startOffset, length),
  });
  return {
    applyPdfReadingPreferences: vi.fn(),
    PdfDocument: class {
      ready = Promise.resolve();
      numPages = 3;
      getPage = async (pageNumber: number) => makePage(pageNumber);
      classifyUntaggedPages = async () => undefined;
      setReadingPreferences = vi.fn();
      destroy = async () => undefined;
    },
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })),
  );
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array([3]).buffer } });
  fake.canvas.mockImplementation(async () => document.createElement('canvas'));
  fake.textLayer.mockImplementation(() => document.createElement('div'));
  window.a11yNotebook = {
    vault: {
      listPdfAnnotations: vi.fn(async () => []),
      getPdfFormValues: vi.fn(async () => ({})),
      savePdfFormValues: vi.fn(async () => undefined),
    },
  } as unknown as NotebookBridge;
});

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderReader(): Promise<{ current: PdfBookmarkApi | null }> {
  const apiRef: { current: PdfBookmarkApi | null } = { current: null };
  render(<DocumentReader path="book.pdf" kind=".pdf" pdfBookmarkRef={apiRef} />);
  // Continuous view renders every page up front, so the first open takes
  // longer than the old single-page render.
  await screen.findByRole('heading', { name: 'Page 1 of 3' }, { timeout: 10000 });
  await screen.findByText('gamma', {}, { timeout: 10000 });
  await waitFor(() => expect(apiRef.current).not.toBeNull());
  return apiRef;
}

function placeCollapsedSelection(text: string, offset: number): void {
  const span = screen.getByText(text);
  const node = span.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('PDF bookmarks in the reader', () => {
  it('reads the current page and spot from the selection', async () => {
    const apiRef = await renderReader();
    placeCollapsedSelection('Alpha', 3);
    expect(apiRef.current?.getCurrentSpot()).toEqual({ page: 1, offset: 3 });
  });

  it('reads the current page and spot from the focused block', async () => {
    const apiRef = await renderReader();
    fireEvent.click(screen.getByRole('radio', { name: 'Paginated view' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Paginated view' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByRole('heading', { name: 'Page 2 of 3' });
    (screen.getByText('Zeta').closest('p') as HTMLElement).focus();
    expect(apiRef.current?.getCurrentSpot()).toEqual({ page: 2, offset: 13 });
  });

  it('reads the top of the current page with no selection or focus', async () => {
    const apiRef = await renderReader();
    fireEvent.click(screen.getByRole('radio', { name: 'Paginated view' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Paginated view' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByRole('heading', { name: 'Page 2 of 3' });
    expect(apiRef.current?.getCurrentSpot()).toEqual({ page: 2, offset: 0 });
  });

  it('jumps to a spot on another page in paginated view, with focus and a live selection', async () => {
    const apiRef = await renderReader();
    fireEvent.click(screen.getByRole('radio', { name: 'Paginated view' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Paginated view' })).toBeChecked());
    const landed = await apiRef.current!.jumpToSpot({ page: 2, offset: 15 });
    expect(landed).toBe(true);
    await screen.findByRole('heading', { name: 'Page 2 of 3' });
    const block = screen.getByText('Zeta').closest('p') as HTMLElement;
    expect(document.activeElement).toBe(block);
    // The selection starts at the bookmarked offset, the way Find
    // selects a match, so the virtual cursor follows the focus.
    expect(window.getSelection()?.toString()).toBe('ta ');
  });

  it('jumps to a spot in continuous view', async () => {
    const apiRef = await renderReader();
    fireEvent.click(screen.getByRole('radio', { name: 'Continuous view' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Continuous view' })).toBeChecked());
    const landed = await apiRef.current!.jumpToSpot({ page: 1, offset: 2 });
    expect(landed).toBe(true);
    const block = screen.getByText('Alpha').closest('p') as HTMLElement;
    expect(document.activeElement).toBe(block);
    expect(window.getSelection()?.toString()).toBe('pha ');
  });

  it('jumps to a spot on the current page without a page turn', async () => {
    const apiRef = await renderReader();
    const landed = await apiRef.current!.jumpToSpot({ page: 1, offset: 6 });
    expect(landed).toBe(true);
    const block = screen.getByText('Alpha').closest('p') as HTMLElement;
    expect(document.activeElement).toBe(block);
    expect(window.getSelection()?.toString()).toBe('beta ');
  });

  it('lands on the page itself when the page has no extractable text', async () => {
    const apiRef = await renderReader();
    const landed = await apiRef.current!.jumpToSpot({ page: 3, offset: 0 });
    expect(landed).toBe(true);
    await screen.findByRole('heading', { name: 'Page 3 of 3' });
    const section = screen.getByLabelText('Accessible text for PDF page 3');
    // In Continuous view the landing focuses the page's own wrapper, not
    // the first div in the section.
    expect(document.activeElement).toBe(section.querySelector('[data-pdf-page="3"]'));
  });

  it('fails fast for a page beyond the document', async () => {
    const apiRef = await renderReader();
    await expect(apiRef.current!.jumpToSpot({ page: 9, offset: 0 })).resolves.toBe(false);
  });
});
