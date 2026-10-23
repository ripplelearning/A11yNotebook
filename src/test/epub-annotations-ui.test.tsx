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
  const rendition = {
    display,
    destroy: vi.fn(),
    annotations: annotationsApi,
    on: (event: string, handler: (...args: never[]) => void) => handlers.set(event, handler),
  };
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
  const book = {
    spine: {
      spineItems,
      get: (target: string) =>
        target.includes('/6/2') ? spineItems[0] : target.includes('/6/4') ? spineItems[1] : spineItems[0],
    },
    navigation: { toc: [] },
    renderTo: vi.fn((container: HTMLElement) => {
      container.appendChild(document.createElement('iframe'));
      return rendition;
    }),
    destroy: vi.fn(),
  };
  ePub.mockResolvedValue(book);
  return { book, rendition, handlers, annotationsApi, display };
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
});
