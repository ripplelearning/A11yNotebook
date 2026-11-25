import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../renderer/features/previews/DocumentReader';
import type { NotebookBridge } from '../shared/bridge';
import type { EpubAnnotation } from '../shared/epub-annotations';

const { ePub } = vi.hoisted(() => ({ ePub: vi.fn() }));
vi.mock('epubjs/src/index.js', () => ({ default: ePub }));

const existing: EpubAnnotation = {
  id: 'e1eebc2a-4444-4333-8222-111111111111',
  path: 'Books/Guide.epub',
  anchor: {
    cfiRange: 'epubcfi(/6/2!/4/2,/1:5,/1:16)',
    sectionHref: 'Text/one.xhtml',
    quote: 'chapter text',
    prefix: 'First ',
    suffix: ' here',
  },
  color: 'yellow',
  label: 'Start',
  comment: '',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  schemaVersion: 1,
};

function installBook() {
  const handlers = new Map<string, (...args: never[]) => void>();
  const annotationsApi = { add: vi.fn(), remove: vi.fn() };
  const display = vi.fn(async () => undefined);
  const getContents = vi.fn(() => [
    {
      document,
      range: () => rangeOverQuote(),
    },
  ]);
  const rendition = {
    display,
    destroy: vi.fn(),
    annotations: annotationsApi,
    getContents,
    attachTo: vi.fn((element: HTMLElement) => {
      element.appendChild(document.createElement('iframe'));
    }),
    on: (event: string, handler: (...args: never[]) => void) => handlers.set(event, handler),
  };
  // A function expression (not an arrow function): the adapter constructs
  // the Rendition with `new`, and arrow functions cannot be constructed.
  const Rendition = vi.fn(function MockRendition() {
    return rendition;
  });
  const spineItems = [
    {
      index: 0,
      href: 'Text/one.xhtml',
      load: async () => ({ textContent: 'First chapter text here' }),
      hooks: { serialize: { register: vi.fn() } },
    },
    {
      index: 1,
      href: 'Text/two.xhtml',
      load: async () => ({ textContent: 'Second chapter text' }),
      hooks: { serialize: { register: vi.fn() } },
    },
  ];
  const epub = {
    open: vi.fn(async () => undefined),
    navigation: { toc: [] },
    book: {
      sections: {
        spineItems,
        get: (target: string) =>
          target.includes('/6/2') ? spineItems[0] : target.includes('/6/4') ? spineItems[1] : spineItems[0],
      },
      manifest: { spine: spineItems.map(({ href }) => ({ href })) },
      destroy: vi.fn(),
    },
    resources: { resolve: (href: string) => href },
    destroy: vi.fn(),
  };
  (ePub as unknown as Record<string, unknown>).Rendition = Rendition;
  (ePub as unknown as Record<string, unknown>).ViewManagers = { default: class {} };
  (ePub as unknown as Record<string, unknown>).Views = { iframe: class {} };
  ePub.mockResolvedValue(epub);
  return { rendition, handlers, annotationsApi, display, getContents };
}

/**
 * The range epub.js would resolve for the annotation's CFI: the words
 * "chapter text" inside the section text the reader renders. Built
 * lazily from the rendered article, so it follows the current section.
 */
function rangeOverQuote(): Range | null {
  const paragraph = document.querySelector('article p');
  const textNode = paragraph?.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const text = textNode.textContent ?? '';
  const start = text.indexOf('chapter text');
  if (start < 0) return null;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + 'chapter text'.length);
  return range;
}

function installVault(overrides: Record<string, unknown> = {}) {
  const vault = {
    readAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getReadingPosition: vi.fn(async () => null),
    setReadingPosition: vi.fn(async () => undefined),
    listEpubAnnotations: vi.fn(async () => [existing]),
    addEpubAnnotation: vi.fn(async (input: unknown) => ({ ...(input as object), id: 'new-id' })),
    updateEpubAnnotation: vi.fn(async () => existing),
    deleteEpubAnnotation: vi.fn(async () => undefined),
    ...overrides,
  };
  window.a11yNotebook = { vault } as unknown as NotebookBridge;
  return vault;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }),
  );
});

afterEach(() => {
  delete window.a11yNotebook;
  vi.unstubAllGlobals();
});

describe('ePub annotations in the reader', () => {
  it('lists annotations, applies rendition highlights, and deletes through the bridge', async () => {
    const { annotationsApi } = installBook();
    const vault = installVault();
    const { container } = render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);
    expect(await screen.findByText('First chapter text here')).toBeInTheDocument();
    const section = container.querySelector('section[aria-label="ePub annotations"]')!;
    expect(await within(section as HTMLElement).findByText('Start')).toBeTruthy();
    await waitFor(() =>
      expect(annotationsApi.add).toHaveBeenCalledWith(
        'highlight',
        existing.anchor.cfiRange,
        {},
        expect.any(Function),
        'a11y-epub-highlight',
        expect.objectContaining({ fill: '#ffe082' }),
      ),
    );
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Delete annotation: Start' }));
    await waitFor(() => expect(vault.deleteEpubAnnotation).toHaveBeenCalledWith('Books/Guide.epub', existing.id));
    await waitFor(() => expect(annotationsApi.remove).toHaveBeenCalledWith(existing.anchor.cfiRange, 'highlight'));
  });

  it('creates an annotation from an epub.js selection event', async () => {
    const { handlers } = installBook();
    const vault = installVault({ listEpubAnnotations: vi.fn(async () => []) });
    render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);
    expect(await screen.findByText('First chapter text here')).toBeInTheDocument();
    const selected = handlers.get('selected')!;
    act(() => {
      selected(
        'epubcfi(/6/2!/4/2,/1:5,/1:16)' as never,
        { range: () => ({ toString: () => 'chapter text' }) } as never,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annotate selection' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Highlight label'), { target: { value: 'Start' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save annotation' }));
    await waitFor(() =>
      expect(vault.addEpubAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Books/Guide.epub',
          anchor: expect.objectContaining({
            cfiRange: 'epubcfi(/6/2!/4/2,/1:5,/1:16)',
            sectionHref: 'Text/one.xhtml',
            quote: 'chapter text',
          }),
        }),
      ),
    );
  });

  it('marks an annotation orphaned when its quote leaves the section text', async () => {
    installBook();
    installVault({
      listEpubAnnotations: vi.fn(async () => [
        { ...existing, anchor: { ...existing.anchor, quote: 'vanished words' } },
      ]),
    });
    const { container } = render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);
    expect(await screen.findByText('First chapter text here')).toBeInTheDocument();
    const section = container.querySelector('section[aria-label="ePub annotations"]')!;
    expect(await within(section as HTMLElement).findByText(/Highlight unavailable/)).toBeTruthy();
  });

  it('jump to an annotation in the current section moves focus and selection to the annotated text', async () => {
    installBook();
    installVault();
    const { container } = render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);
    expect(await screen.findByText('First chapter text here')).toBeInTheDocument();
    const section = container.querySelector('section[aria-label="ePub annotations"]')!;
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Jump to annotation: Start' }));
    // Focus the element holding the annotated text and select that text
    // as a text-node range — the Find way — so the screen reader's
    // virtual cursor lands on the annotation, not just the button.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByText('First chapter text here'));
      expect(window.getSelection()?.toString()).toBe('chapter text');
    });
    expect(await within(section as HTMLElement).findByText('Jumped to annotation: Start.')).toBeTruthy();
  });

  it('jump to an annotation in another section navigates there first, then lands on the spot', async () => {
    const { display, handlers } = installBook();
    const otherSection: EpubAnnotation = {
      ...existing,
      anchor: {
        cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:6)',
        sectionHref: 'Text/two.xhtml',
        quote: 'chapter text',
        prefix: 'Second ',
        suffix: '',
      },
      label: 'Later',
    };
    installVault({ listEpubAnnotations: vi.fn(async () => [otherSection]) });
    const { container } = render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);
    expect(await screen.findByText('First chapter text here')).toBeInTheDocument();
    const section = container.querySelector('section[aria-label="ePub annotations"]')!;
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Jump to annotation: Later' }));
    // The section change routes through the display effect, which shows
    // the annotation's CFI — not the section start.
    await waitFor(() => expect(display).toHaveBeenCalledWith(otherSection.anchor.cfiRange));
    await waitFor(() => expect(screen.getByText('Section 2 of 2')).toBeInTheDocument());
    // Nothing has landed yet: the rendition has not confirmed the move.
    expect(window.getSelection()?.toString()).toBe('');
    act(() => {
      handlers.get('relocated')!({ start: { cfi: otherSection.anchor.cfiRange } } as never);
    });
    expect(await screen.findByText('Second chapter text')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByText('Second chapter text'));
      expect(window.getSelection()?.toString()).toBe('chapter text');
    });
    expect(await within(section as HTMLElement).findByText('Jumped to annotation: Later.')).toBeTruthy();
  });

  it('jump reports honestly when the annotation spot can no longer be located', async () => {
    const { getContents } = installBook();
    getContents.mockReturnValue([]);
    installVault();
    const { container } = render(<DocumentReader path="Books/Guide.epub" kind=".epub" />);
    expect(await screen.findByText('First chapter text here')).toBeInTheDocument();
    const section = container.querySelector('section[aria-label="ePub annotations"]')!;
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Jump to annotation: Start' }));
    expect(
      await within(section as HTMLElement).findByText('That annotation could not be located in the book view.', {}, { timeout: 5000 }),
    ).toBeTruthy();
  });
});
