import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultBookmark, VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { selectTextRange } from '../renderer/pdf-semantic/text-layer';
import { vaultExtensions } from './vault-extensions';

// jsdom does not implement scrollIntoView; the app only needs the call to
// be harmless, so stub it once for this file.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

const fake = vi.hoisted(() => ({
  canvas: vi.fn(),
  textLayer: vi.fn(),
  preferences: { hideHeadersFooters: false, hidePageNumbers: false },
}));

vi.mock('../renderer/hooks/usePdfReadingPreferences', () => ({
  usePdfReadingPreferences: () => fake.preferences,
}));

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

const pageTexts = ['Alpha beta gamma', 'Delta epsilonZeta eta'];

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
      numPages = 2;
      getPage = async (pageNumber: number) => makePage(pageNumber);
      classifyUntaggedPages = async () => undefined;
      setReadingPreferences = vi.fn();
      destroy = async () => undefined;
    },
  };
});

const NOTE_CONTENT = '# Field Notes\n\nIntro paragraph.\n\n## Setup\n\nSetup details here.\n';

const noteBookmark: VaultBookmark = {
  id: 'bm-note',
  path: 'Docs/Field Notes.md',
  title: 'Setup',
  created: new Date().toISOString(),
  anchor: { kind: 'heading', text: 'Setup', occurrence: 0 },
  name: 'Setup mark',
};

const pdfBookmark: VaultBookmark = {
  id: 'bm-pdf',
  path: 'Docs/Guide.pdf',
  title: 'Guide',
  created: new Date().toISOString(),
  anchor: { kind: 'page', page: 1, offset: 0 },
  name: 'My spot',
};

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })),
  );
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array([3]).buffer } });
  fake.canvas.mockImplementation(async () => document.createElement('canvas'));
  fake.textLayer.mockImplementation(() => document.createElement('div'));
});

function setup(seeded: VaultBookmark[] = []) {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [
      {
        name: 'Docs',
        path: 'Docs',
        kind: 'notebook',
        provenance: 'created',
        children: [
          { name: 'Guide.pdf', path: 'Docs/Guide.pdf', kind: 'attachment', provenance: 'created' },
          { name: 'Field Notes.md', path: 'Docs/Field Notes.md', kind: 'note', provenance: 'created' },
        ],
      },
    ],
  };
  let current = [...seeded];
  let menuListener: (command: MenuCommand) => void = () => undefined;
  const addBookmark = vi.fn(async (path: string, anchor: VaultBookmark['anchor'], name?: string) => {
    current = [
      ...current,
      {
        id: `bm-${current.length + 1}`,
        path,
        title:
          path
            .split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '') ?? path,
        created: new Date().toISOString(),
        ...(anchor ? { anchor } : {}),
        ...(name ? { name } : {}),
      },
    ];
    return current;
  });
  const removeBookmark = vi.fn(async (id: string) => {
    current = current.filter((bookmark) => bookmark.id !== id);
    return current;
  });
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => NOTE_CONTENT),
      saveNote: vi.fn(async () => undefined),
      readAttachment: vi.fn(async () => ({ path: 'Docs/Guide.pdf', text: '', kind: '.pdf' })),
      getTasks: vi.fn(async () => []),
      getTaskLinks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => current),
      getReadingPosition: vi.fn(async () => null),
      setReadingPosition: vi.fn(async () => undefined),
      toggleBookmark: vi.fn(async () => []),
      addBookmark,
      removeBookmark,
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
    },
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = () => undefined;
      };
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  render(<App />);
  return { addBookmark, removeBookmark, menu: (command: MenuCommand) => act(() => menuListener(command)) };
}

async function openPdf() {
  await screen.findByRole('heading', { name: 'Study' });
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Docs' }), { key: 'Enter' });
  await screen.findByText('Items in Docs');
  const grid = screen.getByRole('grid', { name: 'Notes and files' });
  fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Guide.pdf' }), { key: 'Enter' });
  await screen.findByRole('heading', { name: 'Page 1 of 2' });
  await screen.findByText('gamma');
}

async function openNote() {
  // Back to the file grid first: the PDF tab is showing, not the grid.
  fireEvent.keyDown(document.body, { key: '2', ctrlKey: true });
  await screen.findByRole('gridcell', { name: 'Docs' });
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Docs' }), { key: 'Enter' });
  await screen.findByText('Items in Docs');
  const grid = screen.getByRole('grid', { name: 'Notes and files' });
  fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Field Notes.md' }), { key: 'Enter' });
  await screen.findByRole('heading', { name: 'Field Notes', level: 2 });
}

function statusBar() {
  return screen.getByLabelText('Status bar');
}

/** Place a collapsed selection in the rendered PDF text, the way a screen reader's virtual cursor leaves it. */
function placePdfSelection(text: string, offset: number) {
  const span = screen.getByText(text);
  const node = span.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('PDF bookmarks in the app', () => {
  it('sets a PDF bookmark with Ctrl+Alt+H, prefilled with the page, and lists it', async () => {
    const { addBookmark } = setup();
    await openPdf();
    placePdfSelection('Alpha', 3);
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Page 1');
    fireEvent.change(within(dialog).getByLabelText('Bookmark name'), { target: { value: 'My spot' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        'Docs/Guide.pdf',
        { kind: 'page', page: 1, offset: 3 },
        'My spot',
        undefined,
      ),
    );
    await waitFor(() => expect(statusBar()).toHaveTextContent('Bookmarked "My spot" on page 1.'));
    expect(screen.getByRole('button', { name: 'My spot (Page 1)' })).toBeInTheDocument();
  });

  it('sets a PDF bookmark with Ctrl+Alt+J under its default Page N name', async () => {
    const { addBookmark } = setup();
    await openPdf();
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Page 1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        'Docs/Guide.pdf',
        { kind: 'page', page: 1, offset: 0 },
        'Page 1',
        undefined,
      ),
    );
    await waitFor(() => expect(statusBar()).toHaveTextContent('Bookmarked "Page 1" on page 1.'));
  });

  it('scopes the list to the open file and shows all bookmarks with nothing open', async () => {
    setup([noteBookmark, pdfBookmark]);
    await openPdf();
    await waitFor(() => expect(screen.getByRole('button', { name: 'My spot (Page 1)' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Setup mark — Field Notes.md' })).not.toBeInTheDocument();
    // The note's own bookmarks, and only those, once it is open.
    await openNote();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Setup mark — Field Notes.md' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'My spot (Page 1)' })).not.toBeInTheDocument();
    // Back to the file grid with nothing open: every bookmark shows.
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Setup mark — Field Notes.md' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /My spot \(Page 1\) — Guide\.pdf/ })).toBeInTheDocument();
  });

  it('jumps into a closed PDF at its bookmarked spot', async () => {
    setup([pdfBookmark]);
    await screen.findByRole('heading', { name: 'Study' });
    // Nothing open: the unscoped list shows the PDF bookmark with its file.
    const button = await screen.findByRole('button', { name: 'My spot (Page 1) — Guide.pdf' });
    fireEvent.click(button);
    await screen.findByRole('heading', { name: 'Page 1 of 2' });
    await waitFor(
      () => {
        const block = screen.getByText('Alpha').closest('p') as HTMLElement;
        expect(document.activeElement).toBe(block);
        expect(window.getSelection()?.toString()).toBe('Alpha ');
      },
      { timeout: 5000 },
    );
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to My spot.'));
  });

  it('removes a PDF bookmark from the list', async () => {
    const { removeBookmark } = setup([pdfBookmark]);
    await openPdf();
    await waitFor(() => expect(screen.getByRole('button', { name: 'My spot (Page 1)' })).toBeInTheDocument());
    const item = screen.getByRole('button', { name: 'My spot (Page 1)' }).closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeBookmark).toHaveBeenCalledWith('bm-pdf'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'My spot (Page 1)' })).not.toBeInTheDocument());
  });
});
