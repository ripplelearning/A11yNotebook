import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotebookBridge } from '../shared/bridge';
import type { PdfAnnotation, PdfAnnotationTarget } from '../shared/pdf-annotation';
import { PdfDocument, type PdfPage } from '../renderer/pdf-semantic';
import { TextModel } from '../renderer/pdf-semantic/text-model';
import PdfNoteDialog from '../renderer/features/previews/PdfNoteDialog';
import PdfNotes from '../renderer/features/previews/PdfNotes';
import PdfQuoteDialog from '../renderer/features/previews/PdfQuoteDialog';
import {
  groupedPdfSelection,
  pdfSelectionCoordinateRoundtrip,
  semanticPdfRange,
} from '../renderer/features/previews/pdf-note-selection';

const target: PdfAnnotationTarget = {
  kind: 'pdf',
  documentIdentity: { fingerprint: 'fp', fileHash: 'hash', vaultPath: 'book.pdf' },
  page: 1,
  canonicalStart: 0,
  canonicalLength: 5,
  exactQuote: 'Hello',
  normalizedQuote: 'hello',
  contextBefore: '',
  contextAfter: ' world hello',
  classification: 'exact',
  confidence: 'certain',
  verification: 'verified',
};
const note: PdfAnnotation = {
  id: 'note-1',
  path: 'book.pdf',
  target,
  label: 'Important',
  comment: 'Remember',
  color: 'yellow',
  createdAt: '2026-10-05T00:00:00Z',
  modifiedAt: '2026-10-05T00:00:00Z',
  schemaVersion: 1,
};

function setup(stored: PdfAnnotation[] = []) {
  const page = {
    pageNum: 1,
    textModel: {
      fullText: 'Hello world Hello',
      items: [{ startOffset: 0, endOffset: 17 }],
      findText: vi.fn(() => [
        { startOffset: 0, length: 5, page: 1 },
        { startOffset: 12, length: 5, page: 1 },
      ]),
    },
    createAnnotationAnchor: vi.fn((start: number, length: number) => ({
      ...target,
      canonicalStart: start,
      canonicalLength: length,
    })),
    highlightAtAnchor: vi.fn((_start: number, _length: number, scale: number, rotation: number) =>
      rotation === 90
        ? [20 * scale, 10 * scale, 10 * scale, 50 * scale]
        : [10 * scale, 20 * scale, 50 * scale, 10 * scale],
    ),
  } as unknown as PdfPage;
  const pdf = {
    getPage: vi.fn(async () => page),
    resolveAnnotationAnchor: vi.fn(async (anchor: PdfAnnotationTarget) => ({
      offset: anchor.canonicalStart,
      length: anchor.canonicalLength,
      page: anchor.page,
      classification: anchor.classification,
      confidence: anchor.confidence,
      verification: anchor.verification ?? 'verified',
      reason: anchor.reason ?? 'Exact canonical quote.',
    })),
  } as unknown as PdfDocument;
  const api = {
    listPdfAnnotations: vi.fn(async () => stored),
    addPdfAnnotation: vi.fn(async (input) => ({ ...note, ...input })),
    updatePdfAnnotation: vi.fn(async (_path, _id, update) => ({ ...note, ...update })),
    deletePdfAnnotation: vi.fn(async () => undefined),
  };
  window.a11yNotebook = { vault: api } as unknown as NotebookBridge;
  return { api, page, pdf };
}

function Harness({
  pdf,
  page,
  path = 'book.pdf',
  scale = 0.75,
  rotation = 0,
}: {
  pdf: PdfDocument;
  page: PdfPage;
  path?: string;
  scale?: number;
  rotation?: number;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const semanticRef = useRef<HTMLDivElement>(null);
  return (
    <section ref={readerRef} data-testid={path} data-context="pdf-selection">
      <div ref={visualRef}>
        <span data-start-offset="0" data-end-offset="17">
          Hello world Hello
        </span>
      </div>
      <div ref={semanticRef}>
        <p tabIndex={0}>
          <span data-start-offset="0" data-end-offset="17">
            Hello world Hello
          </span>
        </p>
      </div>
      <PdfNotes
        document={pdf}
        path={path}
        loadedPages={1}
        readerRef={readerRef}
        visualRef={visualRef}
        semanticRef={semanticRef}
        rendered={{ page, scale, rotation }}
        onNavigate={vi.fn()}
      />
    </section>
  );
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

describe('accessible PDF note dialog', () => {
  it('requires one nonblank value, labels colors, preserves multiline Enter, and submits from input', async () => {
    const save = vi.fn(async () => undefined);
    render(<PdfNoteDialog quote="Hello" onSave={save} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Create PDF note' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label (optional)' })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Highlight color' })).toHaveValue('yellow');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Red',
      'Yellow',
      'Green',
      'Blue',
      'None',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a label or comment');
    const comment = screen.getByRole('textbox', { name: 'Comment (optional)' });
    fireEvent.change(comment, { target: { value: 'First line\nSecond line' } });
    fireEvent.keyDown(comment, { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Highlight color' }), { target: { value: 'none' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Highlight color' }), { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Label (optional)' }), { key: 'Enter' });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ label: '', comment: 'First line\nSecond line', color: 'none' }),
    );
  });

  it('keeps the dialog open and retryable after a persistence error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk'));
    const close = vi.fn();
    render(<PdfNoteDialog quote="Hello" onSave={save} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Label (optional)' }), { target: { value: 'Note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('quotation and canonical selection', () => {
  it('roundtrips coordinates with actual render scale/intrinsic rotation without changing canonical UTF16 offsets', () => {
    const model = new TextModel(
      [
        {
          str: 'A😀BC',
          dir: 'ltr',
          transform: [10, 0, 0, 10, 10, 80],
          width: 50,
          height: 10,
          fontName: 'test',
          hasEOL: false,
        },
      ],
      new Map(),
      [0, 0, 100, 100],
    );
    const coordinates = vi.spyOn(model, 'coordinatesToOffset');
    const page = { canRotate: 90, textModel: model } as PdfPage;
    const range = { start: 1, length: 2 };
    expect(pdfSelectionCoordinateRoundtrip(page, range.start, range.length, 0.75, 90)).toBe('exact');
    expect(coordinates).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 0.75, 180);
    expect(model.fullText.slice(range.start, range.start + range.length)).toBe('😀');
    expect(range).toEqual({ start: 1, length: 2 });
    coordinates.mockReturnValue(0);
    expect(pdfSelectionCoordinateRoundtrip(page, range.start, range.length, 0.75, 90)).toBe('approximate');
    expect(range).toEqual({ start: 1, length: 2 });
  });

  it('never picks an ambiguous quotation automatically and presents page/context radios', async () => {
    const { pdf } = setup();
    const choose = vi.fn();
    render(<PdfQuoteDialog document={pdf} loadedPages={1} onChoose={choose} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Quotation text' }), { target: { value: 'Hello' } });
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Use selected quotation' })).toBeDisabled();
    expect(choose).not.toHaveBeenCalled();
    expect(screen.getAllByRole('radio')[1]).toHaveAccessibleName(/Page 1, occurrence 2: Hello world Hello/);
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected quotation' }));
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ page: 1, start: 12, length: 5 }));
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
  });

  it('maps nested DOM ranges and groups a cross-page selection without quote guessing', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div><span data-start-offset="10" data-end-offset="15"><b>Hello</b></span></div><div><span data-start-offset="0" data-end-offset="5">World</span></div>';
    document.body.append(root);
    const layers = Array.from(root.children) as HTMLElement[];
    const range = document.createRange();
    range.setStart(layers[0].querySelector('b')!.firstChild!, 2);
    range.setEnd(layers[1].querySelector('span')!.firstChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(
      groupedPdfSelection(
        selection,
        layers.map((element, index) => ({ page: index + 1, element })),
      ),
    ).toEqual([
      { page: 1, start: 12, length: 3 },
      { page: 2, start: 0, length: 3 },
    ]);
    root.remove();
  });

  it('anchors a focused cell to its canonical spans, not repeated surrounding text', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<table><tbody><tr><td><span data-start-offset="12" data-end-offset="17">Hello</span></td></tr></tbody></table>';
    expect(semanticPdfRange(root.querySelector('span'), root, 2)).toEqual({ page: 2, start: 12, length: 5 });
    expect(semanticPdfRange(document.body, root, 2)).toBeNull();
  });
});

describe('PDF notes reader integration', () => {
  it('offers an explicit Annotate a quote action independent of pointer selection', async () => {
    const { pdf, page, api } = setup();
    render(<Harness pdf={pdf} page={page} />);
    const annotate = screen.getByRole('button', { name: 'Annotate a quote' });
    await waitFor(() => expect(annotate).toBeEnabled());
    fireEvent.click(annotate);
    await screen.findByRole('dialog', { name: 'Choose PDF quotation' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Quotation text' }), { target: { value: 'Hello' } });
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Use selected quotation' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected quotation' }));
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(api.addPdfAnnotation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label (optional)' }), { target: { value: 'Quote note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.addPdfAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Quote note',
          target: expect.objectContaining({ canonicalStart: 0, canonicalLength: 5 }),
        }),
      ),
    );
    expect(api.addPdfAnnotation.mock.calls[0][0].target.manuallyConfirmed).toBe(true);
  });

  it('scopes semantic commands to the focused reader and focuses the saved note control', async () => {
    const { api, pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <Harness pdf={pdf} page={page} path="other.pdf" />
      </>,
    );
    await waitFor(() => expect(api.listPdfAnnotations).toHaveBeenCalledTimes(2));
    const reader = screen.getByTestId('book.pdf');
    (reader.querySelector('p[tabindex]') as HTMLElement).focus();
    act(() => window.dispatchEvent(new CustomEvent('annotate-current-semantic-element')));
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(page.createAnnotationAnchor).toHaveBeenCalledWith(0, 17);
    fireEvent.change(screen.getByRole('textbox', { name: 'Label (optional)' }), {
      target: { value: 'Selected paragraph' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.addPdfAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'book.pdf', label: 'Selected paragraph' }),
    );
    expect(within(reader).getByRole('button', { name: /Selected paragraph — yellow/ })).toHaveFocus();
  });

  it('uses canonical pointer span offsets and keeps highlights hidden and aligned to render scale/rotation', async () => {
    const { pdf, page } = setup([note]);
    const view = render(<Harness pdf={pdf} page={page} />);
    await waitFor(() => expect(view.container.querySelector('.pdf-note-highlight')).not.toBeNull());
    let overlay = view.container.querySelector('.pdf-note-overlay')!;
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveTextContent('');
    expect(view.container.querySelector('.pdf-note-highlight')).toHaveStyle({ left: '7.5px', width: '37.5px' });
    view.rerender(<Harness pdf={pdf} page={page} scale={0.5} rotation={90} />);
    await waitFor(() =>
      expect(view.container.querySelector('.pdf-note-highlight')).toHaveStyle({ left: '10px', height: '25px' }),
    );
    overlay = view.container.querySelector('.pdf-note-overlay')!;
    expect(overlay.children).toHaveLength(1);
    expect(note.target.canonicalStart).toBe(0);
    const span = view.container.querySelector('span')!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 12);
    range.setEnd(span.firstChild!, 17);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => window.dispatchEvent(new CustomEvent('annotate-pdf-selection')));
    await screen.findByRole('dialog');
    expect(page.createAnnotationAnchor).toHaveBeenLastCalledWith(12, 5);
  });

  it('shows original quote/reason for orphan and ambiguous notes without unsafe highlights or verification', async () => {
    const { pdf, page, api } = setup([note]);
    vi.mocked(pdf.resolveAnnotationAnchor).mockResolvedValue({
      offset: -1,
      page: 1,
      classification: 'ambiguous',
      confidence: 'uncertain',
      verification: 'unverified',
      reason: 'Multiple repeated quotations.',
    });
    const view = render(<Harness pdf={pdf} page={page} />);
    expect(await screen.findByText('Orphaned or ambiguous note: no unique location found.')).toBeInTheDocument();
    expect(screen.getByText('Multiple repeated quotations.')).toBeInTheDocument();
    expect(view.container.querySelector('blockquote')).toHaveTextContent('Hello');
    expect(view.container.querySelector('.pdf-note-highlight')).toBeNull();
    expect(screen.queryByRole('button', { name: /Verify location/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Important' }));
    await waitFor(() => expect(api.deletePdfAnnotation).toHaveBeenCalledWith('book.pdf', 'note-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Important' })).not.toBeInTheDocument());
  });

  it('manually verifies a uniquely resolved but unverified location with the current file identity', async () => {
    const { pdf, page, api } = setup([
      { ...note, target: { ...target, verification: 'unverified', confidence: 'probable' } },
    ]);
    const view = render(<Harness pdf={pdf} page={page} />);
    const verify = await screen.findByRole('button', { name: 'Verify location for Important' });
    expect(view.container.querySelector('.pdf-note-highlight')).toBeNull();
    fireEvent.click(verify);
    await waitFor(() =>
      expect(api.updatePdfAnnotation).toHaveBeenCalledWith('book.pdf', 'note-1', {
        target: expect.objectContaining({
          verification: 'verified',
          manuallyConfirmed: true,
          documentIdentity: target.documentIdentity,
        }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Verify location/ })).not.toBeInTheDocument());
    expect(view.container.querySelector('.pdf-note-highlight')).not.toBeNull();
  });

  it('retains the last semantic block when a context-menu command explicitly names the active PDF', async () => {
    const { pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <button type="button">Context menu command</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    (screen.getByTestId('book.pdf').querySelector('p[tabindex]') as HTMLElement).focus();
    screen.getByRole('button', { name: 'Context menu command' }).focus();
    act(() =>
      window.dispatchEvent(new CustomEvent('annotate-current-semantic-element', { detail: { path: 'other.pdf' } })),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(new CustomEvent('annotate-current-semantic-element', { detail: { path: 'book.pdf' } })),
    );
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(page.createAnnotationAnchor).toHaveBeenCalledWith(0, 17);
  });

  it('does not let an old selection activate a different reader than the focused PDF', async () => {
    const { pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <Harness pdf={pdf} page={page} path="other.pdf" />
      </>,
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: 'Create PDF note' })
          .every((button) => !(button as HTMLButtonElement).disabled),
      ).toBe(true),
    );
    const first = screen.getByTestId('book.pdf');
    const span = first.querySelector('span')!;
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    (screen.getByTestId('other.pdf').querySelector('p[tabindex]') as HTMLElement).focus();
    act(() => window.dispatchEvent(new CustomEvent('annotate-pdf-selection')));
    await screen.findByRole('dialog', { name: 'Choose PDF quotation' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(page.createAnnotationAnchor).not.toHaveBeenCalled();
  });

  it('shows an orphan reason and original quote without attempting to highlight or verify it', async () => {
    const { pdf, page } = setup([note]);
    vi.mocked(pdf.resolveAnnotationAnchor).mockResolvedValue({
      orphaned: true,
      classification: 'orphan',
      confidence: 'uncertain',
      verification: 'unverified',
      reason: 'The original text was removed.',
    });
    const view = render(<Harness pdf={pdf} page={page} />);
    expect(await screen.findByText('The original text was removed.')).toBeInTheDocument();
    expect(view.container.querySelector('blockquote')).toHaveTextContent('Hello');
    expect(view.container.querySelector('.pdf-note-highlight')).toBeNull();
    expect(screen.queryByRole('button', { name: /Verify location/ })).not.toBeInTheDocument();
  });

  it('does not trust a resolved offset without a valid canonical length', async () => {
    const { pdf, page } = setup([note]);
    vi.mocked(pdf.resolveAnnotationAnchor).mockResolvedValue({
      offset: 0,
      page: 1,
      classification: 'exact',
      confidence: 'certain',
      verification: 'verified',
      reason: 'Resolution has no canonical length.',
    });
    const view = render(<Harness pdf={pdf} page={page} />);
    expect(await screen.findByText('Resolution has no canonical length.')).toBeInTheDocument();
    expect(view.container.querySelector('.pdf-note-highlight')).toBeNull();
    expect(screen.queryByRole('button', { name: /Verify location/ })).not.toBeInTheDocument();
  });

  it('uses the cloned context-menu range after the live selection and focus have moved', async () => {
    const { pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <button type="button">Global menu</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    const span = screen.getByTestId('book.pdf').querySelector('span')!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 12);
    range.setEnd(span.firstChild!, 17);
    const clone = range.cloneRange();
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    window.getSelection()!.removeAllRanges();
    let restoredQuote = '';
    const selection = window.getSelection()!;
    const addRange = selection.addRange.bind(selection);
    vi.spyOn(selection, 'addRange').mockImplementation((restored) => {
      restoredQuote = restored.toString();
      addRange(restored);
    });
    screen.getByRole('button', { name: 'Global menu' }).focus();
    act(() => window.dispatchEvent(new CustomEvent('annotate-pdf-selection', { detail: { range: clone } })));
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(page.createAnnotationAnchor).toHaveBeenCalledWith(12, 5);
    expect(restoredQuote).toBe('Hello');
  });

  it('uses the original semantic context-menu element without changing global focus', async () => {
    const { pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <button type="button">Global menu</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    const element = screen.getByTestId('book.pdf').querySelector('p[tabindex]') as HTMLElement;
    screen.getByRole('button', { name: 'Global menu' }).focus();
    act(() => window.dispatchEvent(new CustomEvent('annotate-current-semantic-element', { detail: { element } })));
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(page.createAnnotationAnchor).toHaveBeenCalledOnce();
    expect(page.createAnnotationAnchor).toHaveBeenCalledWith(0, 17);
  });

  it('retains the selected canonical range for a deferred palette command after selection collapse', async () => {
    const { pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <button type="button">Palette</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    const span = screen.getByTestId('book.pdf').querySelector('span')!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 1);
    range.setEnd(span.firstChild!, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => document.dispatchEvent(new Event('selectionchange')));
    screen.getByRole('button', { name: 'Palette' }).focus();
    window.getSelection()!.removeAllRanges();
    act(() => document.dispatchEvent(new Event('selectionchange')));
    await act(
      async () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('annotate-pdf-selection'));
            resolve();
          }, 0),
        ),
    );
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(page.createAnnotationAnchor).toHaveBeenCalledWith(1, 4);
  });

  it('retains the focused semantic node for a deferred palette command and ignores handled commands', async () => {
    const { pdf, page } = setup();
    render(
      <>
        <Harness pdf={pdf} page={page} />
        <button type="button">Palette</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    (screen.getByTestId('book.pdf').querySelector('p[tabindex]') as HTMLElement).focus();
    screen.getByRole('button', { name: 'Palette' }).focus();
    const handled = new CustomEvent('annotate-current-semantic-element', { cancelable: true });
    handled.preventDefault();
    act(() => window.dispatchEvent(handled));
    expect(page.createAnnotationAnchor).not.toHaveBeenCalled();
    await act(
      async () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('annotate-current-semantic-element'));
            resolve();
          }, 0),
        ),
    );
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(page.createAnnotationAnchor).toHaveBeenCalledOnce();
  });

  it('ignores completion of a save after its PDF reader is unmounted', async () => {
    const { pdf, page, api } = setup();
    let finish: (value: PdfAnnotation) => void = () => undefined;
    api.addPdfAnnotation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<Harness pdf={pdf} page={page} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    (screen.getByTestId('book.pdf').querySelector('p[tabindex]') as HTMLElement).focus();
    act(() => window.dispatchEvent(new CustomEvent('annotate-current-semantic-element')));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Label (optional)' }), {
      target: { value: 'Old PDF' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addPdfAnnotation).toHaveBeenCalledOnce());
    view.unmount();
    render(<Harness pdf={pdf} page={page} path="other.pdf" />);
    await act(async () => finish({ ...note, label: 'Old PDF' }));
    expect(screen.queryByRole('button', { name: /Old PDF —/ })).not.toBeInTheDocument();
    expect(pdf.resolveAnnotationAnchor).not.toHaveBeenCalled();
  });

  it.each(['orphan', 'ambiguous'] as const)(
    'reanchors a %s note onto an explicitly chosen quotation without replacing its id or metadata',
    async (classification) => {
      const { pdf, page, api } = setup([{ ...note, targets: [{ ...target, page: 2 }] }]);
      vi.mocked(pdf.resolveAnnotationAnchor).mockImplementation(async (anchor) =>
        anchor.canonicalStart !== 12
          ? classification === 'orphan'
            ? {
                orphaned: true,
                classification: 'orphan',
                confidence: 'uncertain',
                verification: 'unverified',
                reason: 'The original text was removed.',
              }
            : {
                offset: -1,
                page: 1,
                classification: 'ambiguous',
                confidence: 'uncertain',
                verification: 'unverified',
                reason: 'The original quotation has multiple indistinguishable matches.',
              }
          : {
              offset: 12,
              length: 5,
              page: 1,
              classification: 'exact',
              confidence: 'certain',
              verification: 'verified',
              reason: 'Newly selected canonical quotation.',
            },
      );
      const view = render(<Harness pdf={pdf} page={page} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Re-anchor Important' }));
      expect(screen.getByRole('dialog', { name: 'Choose PDF quotation' })).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: 'Quotation text' }), { target: { value: 'Hello' } });
      await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
      expect(screen.getByRole('button', { name: 'Use selected quotation' })).toBeDisabled();
      fireEvent.click(screen.getAllByRole('radio')[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Use selected quotation' }));
      await screen.findByRole('dialog', { name: 'Reconfirm PDF note location' });
      expect(screen.getByRole('button', { name: 'Save location' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.addPdfAnnotation).not.toHaveBeenCalled();
      expect(api.updatePdfAnnotation).toHaveBeenCalledWith('book.pdf', 'note-1', {
        target: expect.objectContaining({
          canonicalStart: 12,
          canonicalLength: 5,
          verification: 'verified',
          manuallyConfirmed: true,
        }),
        targets: [],
      });
      expect(screen.getByRole('button', { name: 'Important — yellow, page 1' })).toHaveFocus();
      expect(screen.getByText('Remember')).toHaveClass('pdf-note-comment');
      expect(screen.getByText(/Location: exact\. Confidence: certain\. Verification: verified\./)).toBeInTheDocument();
      expect(view.container.querySelector('.pdf-note-highlight')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Re-anchor/ })).not.toBeInTheDocument();
    },
  );

  it('keeps reconfirmation retryable on write failure and cancels without modifying the existing note', async () => {
    const { pdf, page, api } = setup([note]);
    vi.mocked(pdf.resolveAnnotationAnchor).mockResolvedValue({
      orphaned: true,
      classification: 'orphan',
      confidence: 'uncertain',
      reason: 'Original quote is missing.',
    });
    api.updatePdfAnnotation.mockRejectedValue(new Error('disk'));
    const view = render(<Harness pdf={pdf} page={page} />);
    await screen.findByRole('button', { name: 'Re-anchor Important' });
    const span = view.container.querySelector('span')!;
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.click(screen.getByRole('button', { name: 'Re-anchor Important' }));
    await screen.findByRole('dialog', { name: 'Reconfirm PDF note location' });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the new PDF note location.');
    expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Important — yellow, page 1' })).toBeInTheDocument();
    expect(api.addPdfAnnotation).not.toHaveBeenCalled();
    expect(view.container.querySelector('.pdf-note-highlight')).toBeNull();
  });

  it('clears a remembered selection on page rerender before a palette command', async () => {
    const { pdf, page } = setup();
    const view = render(
      <>
        <Harness pdf={pdf} page={page} />
        <button type="button">Palette</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create PDF note' })).toBeEnabled());
    const span = screen.getByTestId('book.pdf').querySelector('span')!;
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => document.dispatchEvent(new Event('selectionchange')));
    window.getSelection()!.removeAllRanges();
    screen.getByRole('button', { name: 'Palette' }).focus();
    view.rerender(
      <>
        <Harness pdf={pdf} page={page} scale={0.5} />
        <button type="button">Palette</button>
      </>,
    );
    act(() => window.dispatchEvent(new CustomEvent('annotate-pdf-selection')));
    await screen.findByRole('dialog', { name: 'Choose PDF quotation' });
    expect(page.createAnnotationAnchor).not.toHaveBeenCalled();
  });

  it('does not dispatch a stale verification update after the PDF reader is disposed', async () => {
    const { pdf, page, api } = setup([{ ...note, target: { ...target, verification: 'unverified' } }]);
    let finish: (value: PdfPage) => void = () => undefined;
    vi.mocked(pdf.getPage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<Harness pdf={pdf} page={page} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify location for Important' }));
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => finish(page));
    expect(api.updatePdfAnnotation).not.toHaveBeenCalled();
    expect(api.addPdfAnnotation).not.toHaveBeenCalled();
  });

  it('discards an older list response after switching documents', async () => {
    const { pdf, page, api } = setup();
    let finish: (notes: PdfAnnotation[]) => void = () => undefined;
    api.listPdfAnnotations.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<Harness pdf={pdf} page={page} />);
    view.rerender(<Harness pdf={pdf} page={page} path="other.pdf" />);
    await waitFor(() => expect(api.listPdfAnnotations).toHaveBeenCalledTimes(2));
    await act(async () => finish([note]));
    expect(screen.queryByRole('button', { name: /Important —/ })).not.toBeInTheDocument();
  });

  it('highlights an explicitly selected repeated occurrence when new-note Save confirms it', async () => {
    const text = `${'a'.repeat(100)}Hello${'a'.repeat(200)}Hello${'a'.repeat(100)}`;
    const model = new TextModel(
      [
        {
          str: text,
          dir: 'ltr',
          transform: [10, 0, 0, 10, 10, 80],
          width: 410,
          height: 10,
          fontName: 'test',
          hasEOL: false,
        },
      ],
      new Map(),
      [0, 0, 500, 100],
      1,
      target.documentIdentity,
    );
    expect(model.createAnchor(1, 305, 5)).toMatchObject({ classification: 'ambiguous', confidence: 'uncertain' });
    const { api, pdf, page } = setup();
    Object.assign(page, {
      textModel: model,
      createAnnotationAnchor: (start: number, length: number) => model.createAnchor(1, start, length),
      canRotate: 0,
    });
    vi.mocked(pdf.resolveAnnotationAnchor).mockImplementation(async (anchor) => model.resolveAnchor(anchor));
    const view = render(<Harness pdf={pdf} page={page} />);
    const annotate = screen.getByRole('button', { name: 'Annotate a quote' });
    await waitFor(() => expect(annotate).toBeEnabled());
    fireEvent.click(annotate);
    fireEvent.change(screen.getByRole('textbox', { name: 'Quotation text' }), { target: { value: 'Hello' } });
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected quotation' }));
    await screen.findByRole('dialog', { name: 'Create PDF note' });
    expect(api.addPdfAnnotation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label (optional)' }), { target: { value: 'Second copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = api.addPdfAnnotation.mock.calls[0][0].target as PdfAnnotationTarget;
    expect(saved).toMatchObject({
      canonicalStart: 305,
      canonicalLength: 5,
      manuallyConfirmed: true,
      verification: 'verified',
    });
    expect(model.resolveAnchor(saved)).toMatchObject({
      offset: 305,
      length: 5,
      confidence: 'certain',
      verification: 'verified',
    });
    expect(view.container.querySelector('.pdf-note-highlight')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-anchor Second copy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second copy — yellow, page 1' })).toHaveFocus();
  });

  it('retains an explicitly reconfirmed identical-context occurrence after reload but not a changed PDF hash', async () => {
    const text = `${'a'.repeat(100)}Hello${'a'.repeat(200)}Hello${'a'.repeat(100)}`;
    const parts = [
      {
        str: text,
        dir: 'ltr',
        transform: [10, 0, 0, 10, 10, 80],
        width: 410,
        height: 10,
        fontName: 'test',
        hasEOL: false,
      },
    ];
    const model = new TextModel(parts, new Map(), [0, 0, 500, 100], 1, target.documentIdentity);
    const original = model.createAnchor(1, 100, 5);
    const { api, pdf, page } = setup([{ ...note, target: original }]);
    Object.assign(page, {
      textModel: model,
      createAnnotationAnchor: (start: number, length: number) => model.createAnchor(1, start, length),
      canRotate: 0,
    });
    vi.mocked(pdf.resolveAnnotationAnchor).mockImplementation(async (anchor) => model.resolveAnchor(anchor));
    const view = render(<Harness pdf={pdf} page={page} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-anchor Important' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Quotation text' }), { target: { value: 'Hello' } });
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected quotation' }));
    await screen.findByRole('dialog', { name: 'Reconfirm PDF note location' });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const confirmed = api.updatePdfAnnotation.mock.calls[0][2].target as PdfAnnotationTarget;
    expect(confirmed).toMatchObject({ canonicalStart: 305, canonicalLength: 5, manuallyConfirmed: true });
    expect(model.resolveAnchor(confirmed)).toMatchObject({
      offset: 305,
      confidence: 'certain',
      verification: 'verified',
    });
    expect(view.container.querySelector('.pdf-note-highlight')).not.toBeNull();
    expect(api.addPdfAnnotation).not.toHaveBeenCalled();
    view.unmount();

    api.listPdfAnnotations.mockResolvedValue([{ ...note, target: confirmed }]);
    const reloaded = render(<Harness pdf={pdf} page={page} />);
    await waitFor(() => expect(reloaded.container.querySelector('.pdf-note-highlight')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Re-anchor Important' })).not.toBeInTheDocument();

    const changed = new TextModel(parts, new Map(), [0, 0, 500, 100], 1, {
      ...target.documentIdentity,
      fileHash: 'changed',
    });
    const changedPage = { ...page, textModel: changed } as PdfPage;
    const changedPdf = {
      getPage: async () => changedPage,
      resolveAnnotationAnchor: async (anchor: PdfAnnotationTarget) => changed.resolveAnchor(anchor),
    } as unknown as PdfDocument;
    reloaded.rerender(<Harness pdf={changedPdf} page={changedPage} />);
    await screen.findByRole('button', { name: 'Re-anchor Important' });
    expect(changed.resolveAnchor(confirmed)).toMatchObject({
      offset: -1,
      classification: 'ambiguous',
      verification: 'unverified',
    });
    expect(reloaded.container.querySelector('.pdf-note-highlight')).toBeNull();
    expect(api.addPdfAnnotation).not.toHaveBeenCalled();
  });
});
