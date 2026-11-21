import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { ReadingPosition, VaultBookmark, VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

// jsdom does not implement scrollIntoView; the app only needs the call to
// be harmless, so stub it once for this file.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

const content = '# Title\n\nIntro text.\n\n## Setup\n\nDetails here.\n';
const setupOffset = content.indexOf('## Setup');

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

function setup(
  bookmarks: VaultBookmark[],
  noteContent: string = content,
  savedPosition: ReadingPosition | null = null,
  settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {},
  getReadingPositionImpl?: () => Promise<ReadingPosition | null>,
  entries: VaultInfo['entries'] = [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
) {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries,
  };
  let menuListener: (command: MenuCommand) => void = () => undefined;
  const addBookmark = vi.fn(async () => bookmarks);
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => noteContent),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => []),
      getTaskLinks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => bookmarks),
      getReadingPosition: vi.fn(getReadingPositionImpl ?? (async () => savedPosition)),
      setReadingPosition: vi.fn(async () => undefined),
      toggleBookmark: vi.fn(async () => []),
      addBookmark,
      removeBookmark: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0, ...settingsOverride })),
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
  return { addBookmark, menu: (command: MenuCommand) => act(() => menuListener(command)) };
}

async function openNote() {
  await screen.findByRole('heading', { name: 'Study' });
  fireEvent.keyDown(document.body, { key: 'V', ctrlKey: true, shiftKey: true });
  fireEvent.click(await screen.findByRole('treeitem', { name: /Note\.md/ }));
  await screen.findByRole('heading', { name: 'Note', level: 2 });
}

function statusBar() {
  return screen.getByLabelText('Status bar');
}

// Put the DOM selection inside the rendered reading text, the way a
// screen reader's virtual cursor leaves it while reading.
function placeReadingSelection(text: string) {
  const element = screen.getByText(text);
  const node = element.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, 1);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('bookmark jump from the side pane', () => {
  const headingBookmark: VaultBookmark = {
    id: 'bm-heading',
    path: 'Note.md',
    title: 'Setup',
    created: new Date().toISOString(),
    anchor: { kind: 'heading', text: 'Setup', occurrence: 0 },
  };

  it('lands focus on the bookmarked heading in reading mode', async () => {
    setup([headingBookmark]);
    await openNote();
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    fireEvent.click(screen.getByRole('button', { name: 'Setup — Note.md' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Jumped to Setup.'),
    );
    expect(document.activeElement).toBe(setupHeading);
    // Focus alone does not move the virtual cursor: the heading text is
    // selected, mirroring Find.
    expect(window.getSelection()?.toString()).toBe('Setup');
    // The selection is a text-node range, as Find selects a match — an
    // element-anchored selection (selectNodeContents) has no character
    // position, so the virtual cursor never followed the jump.
    expect(window.getSelection()?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(window.getSelection()?.anchorOffset).toBe(0);
  });

  it('moves the edit caret to the bookmarked heading in edit mode', async () => {
    setup([headingBookmark]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = (await screen.findByRole('textbox', {
      name: 'Markdown source',
    })) as HTMLTextAreaElement;
    editor.selectionStart = content.length;
    editor.selectionEnd = content.length;
    fireEvent.click(screen.getByRole('button', { name: 'Setup — Note.md' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Jumped to Setup.'),
    );
    expect(document.activeElement).toBe(editor);
    // The heading text itself is selected, not a collapsed caret on it.
    expect(editor.selectionStart).toBe(setupOffset + 3);
    expect(editor.selectionEnd).toBe(setupOffset + 8);
  });

  it('lands a position bookmark on its containing heading in reading mode', async () => {
    const positionBookmark: VaultBookmark = {
      id: 'bm-position',
      path: 'Note.md',
      title: 'Setup',
      created: new Date().toISOString(),
      anchor: { kind: 'offset', offset: content.indexOf('Details here.') },
    };
    setup([positionBookmark]);
    await openNote();
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    fireEvent.click(screen.getByRole('button', { name: 'Setup (position)' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Jumped to Setup.'),
    );
    expect(document.activeElement).toBe(setupHeading);
    expect(window.getSelection()?.toString()).toBe('Setup');
  });

  it('selects the line at a position bookmark in edit mode', async () => {
    const positionBookmark: VaultBookmark = {
      id: 'bm-position-edit',
      path: 'Note.md',
      title: 'Setup',
      created: new Date().toISOString(),
      anchor: { kind: 'offset', offset: content.indexOf('Details here.') },
    };
    setup([positionBookmark]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = (await screen.findByRole('textbox', {
      name: 'Markdown source',
    })) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'Setup (position)' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Jumped to Setup.'),
    );
    expect(document.activeElement).toBe(editor);
    const lineStart = content.indexOf('Details here.');
    expect(editor.selectionStart).toBe(lineStart);
    expect(editor.selectionEnd).toBe(lineStart + 'Details here.'.length);
  });

  it('announces setting a heading and a position bookmark', async () => {
    const { menu } = setup([headingBookmark]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = (await screen.findByRole('textbox', {
      name: 'Markdown source',
    })) as HTMLTextAreaElement;
    const caret = content.indexOf('Details here.') + 3;
    editor.selectionStart = caret;
    editor.selectionEnd = caret;
    menu('bookmark-heading-at-cursor');
    const headingDialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    expect(within(headingDialog).getByLabelText('Bookmark name')).toHaveValue('Setup');
    fireEvent.click(within(headingDialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Bookmarked heading "Setup".'),
    );
    menu('bookmark-position-at-cursor');
    const positionDialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    expect(within(positionDialog).getByLabelText('Bookmark name')).toHaveValue('Details here.');
    fireEvent.change(within(positionDialog).getByLabelText('Bookmark name'), {
      target: { value: 'The details' },
    });
    fireEvent.click(within(positionDialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Bookmarked "The details".'),
    );
  });

  it('keeps the bookmark landing when switching to reading mode after an edit-mode jump', async () => {
    const { menu } = setup([headingBookmark], content, {
      path: 'Note.md',
      heading: 'Title',
      occurrence: 0,
      updated: new Date().toISOString(),
    });
    await openNote();
    // The saved reading position is live: opening resumes at Title.
    await waitFor(() => expect(statusBar()).toHaveTextContent('Resumed at Title.'));
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', {
      name: 'Markdown source',
    })) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'Setup — Note.md' }));
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Jumped to Setup.'),
    );
    expect(editor.selectionStart).toBe(setupOffset + 3);
    expect(editor.selectionEnd).toBe(setupOffset + 8);
    // Switching back to reading must keep the reader at the bookmarked
    // heading, not yank it back to the saved reading position.
    menu('toggle-read-only-mode');
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    await waitFor(() => expect(document.activeElement).toBe(setupHeading));
    expect(statusBar()).toHaveTextContent('Jumped to Setup.');
    expect(window.getSelection()?.toString()).toBe('Setup');
  });

  it('lands on the bookmarked line for a position bookmark with no heading before it', async () => {
    const plainContent = 'Intro text.\n\nMore text.\n';
    const positionBookmark: VaultBookmark = {
      id: 'bm-plain',
      path: 'Note.md',
      title: 'Intro',
      created: new Date().toISOString(),
      anchor: { kind: 'offset', offset: plainContent.indexOf('More text.') },
    };
    setup([positionBookmark], plainContent);
    await openNote();
    const jumpButton = screen.getByRole('button', { name: 'Intro (position)' });
    // A real click focuses the button first; the jump must move focus
    // away from it onto the reading document.
    jumpButton.focus();
    fireEvent.click(jumpButton);
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Jumped to the bookmarked place.'),
    );
    // Focus lands on the reading document with the bookmarked line
    // selected — not on the side-pane button, the body, or the top of
    // the note with no selection.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(jumpButton);
    expect(document.activeElement?.contains(screen.getByText('Intro text.'))).toBe(true);
    expect(window.getSelection()?.toString()).toBe('More text.');
  });

  it('lands on a formatted heading whose anchor stores the source text', async () => {
    const formattedContent = '# Title\n\nIntro text.\n\n## Hello *world*\n\nDetails here.\n';
    const formattedBookmark: VaultBookmark = {
      id: 'bm-formatted',
      path: 'Note.md',
      title: 'Hello world',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Hello *world*', occurrence: 0 },
    };
    setup([formattedBookmark], formattedContent);
    await openNote();
    const heading = screen.getByRole('heading', { name: 'Hello world' });
    fireEvent.click(screen.getByRole('button', { name: 'Hello world — Note.md' }));
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Hello world.'));
    expect(document.activeElement).toBe(heading);
    expect(window.getSelection()?.toString()).toBe('Hello world');
    // A formatted heading spans text nodes ("Hello " + "world"): the
    // range still starts on a text node, as a Find match does.
    expect(window.getSelection()?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('lands focus on an image-only heading in reading mode', async () => {
    // An image-only heading has no text to select, so the old landing
    // check (which required a text-node selection) rejected the focus
    // landing and the jump fell back to the top of the note.
    const imageContent = '# Title\n\nIntro text.\n\n## ![logo](logo.png)\n\nDetails here.\n';
    const imageBookmark: VaultBookmark = {
      id: 'bm-image-only',
      path: 'Note.md',
      title: '![logo](logo.png)',
      name: 'Logo section',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: '![logo](logo.png)', occurrence: 0 },
    };
    setup([imageBookmark], imageContent);
    await openNote();
    const heading = screen.getByRole('heading', { name: 'logo' });
    fireEvent.click(screen.getByRole('button', { name: 'Logo section — Note.md' }));
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to the bookmarked place.'));
    expect(document.activeElement).toBe(heading);
    // Nothing to select in an image-only heading: focus itself is the
    // landing, and the selection stays empty instead of grabbing the
    // top of the note.
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('lands focus on a footnote-ref heading in reading mode', async () => {
    // The rendered heading reads `Usage[1]` while its source stores
    // `Usage[^1]`, so no text comparison matches it; the jump used to
    // fall back to the top of the note while announcing the jump.
    const footnoteContent = '# Title\n\nIntro text.\n\n## Usage[^1]\n\nDetails here.\n\n[^1]: A footnote.\n';
    const footnoteBookmark: VaultBookmark = {
      id: 'bm-footnote',
      path: 'Note.md',
      title: 'Usage[^1]',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Usage[^1]', occurrence: 0 },
    };
    setup([footnoteBookmark], footnoteContent);
    await openNote();
    const heading = screen.getByRole('heading', { name: /Usage/ });
    fireEvent.click(screen.getByRole('button', { name: 'Usage — Note.md' }));
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Usage.'));
    expect(document.activeElement).toBe(heading);
    expect(window.getSelection()?.toString()).toBe('Usage[1]');
    expect(window.getSelection()?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('lands focus on an entity heading in reading mode', async () => {
    // The rendered heading reads `Fish © Chips` while its source stores
    // `Fish &copy; Chips`; the jump used to fall back to the top.
    const entityContent = '# Title\n\nIntro text.\n\n## Fish &copy; Chips\n\nDetails here.\n';
    const entityBookmark: VaultBookmark = {
      id: 'bm-entity',
      path: 'Note.md',
      title: 'Fish &copy; Chips',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Fish &copy; Chips', occurrence: 0 },
    };
    setup([entityBookmark], entityContent);
    await openNote();
    const heading = screen.getByRole('heading', { name: 'Fish © Chips' });
    fireEvent.click(screen.getByRole('button', { name: 'Fish © Chips — Note.md' }));
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Fish © Chips.'));
    expect(document.activeElement).toBe(heading);
    expect(window.getSelection()?.toString()).toBe('Fish © Chips');
  });

  it('creates a footnote heading bookmark from the reading position', async () => {
    // Ctrl+Alt+H no longer sets a heading bookmark — it sets a position
    // bookmark — so the heading command goes through the Tools menu /
    // command palette, where it keeps working.
    const { addBookmark, menu } = setup(
      [headingBookmark],
      '# Title\n\nIntro text.\n\n## Usage[^1]\n\nDetails here.\n\n[^1]: A footnote.\n',
    );
    await openNote();
    placeReadingSelection('Details here.');
    menu('bookmark-heading-at-cursor');
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    // The suggested name reads as the reader sees the heading, without
    // the footnote marker.
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Usage');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        'Note.md',
        { kind: 'heading', text: 'Usage[^1]', occurrence: 0 },
        'Usage',
        undefined,
      ),
    );
  });

  it('creates an entity heading bookmark from the reading position', async () => {
    // Ctrl+Alt+H no longer sets a heading bookmark — it sets a position
    // bookmark — so the heading command goes through the Tools menu /
    // command palette, where it keeps working.
    const { addBookmark, menu } = setup(
      [headingBookmark],
      '# Title\n\nIntro text.\n\n## Fish &copy; Chips\n\nDetails here.\n',
    );
    await openNote();
    placeReadingSelection('Details here.');
    menu('bookmark-heading-at-cursor');
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Fish © Chips');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        'Note.md',
        { kind: 'heading', text: 'Fish &copy; Chips', occurrence: 0 },
        'Fish © Chips',
        undefined,
      ),
    );
  });

  it('a slow saved-position load does not yank focus off a just-landed bookmark jump', async () => {
    // Opening the note starts a saved-position load; a jump that lands
    // while it is still in flight owns the focus, and the load resolving
    // afterwards must not resume to the saved heading instead.
    const saved: ReadingPosition = {
      path: 'Note.md',
      heading: 'Title',
      occurrence: 0,
      updated: new Date().toISOString(),
    };
    let resolvePosition!: (value: ReadingPosition | null) => void;
    const positionPromise = new Promise<ReadingPosition | null>((resolve) => {
      resolvePosition = resolve;
    });
    setup([headingBookmark], content, saved, {}, () => positionPromise);
    await openNote();
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    fireEvent.click(screen.getByRole('button', { name: 'Setup — Note.md' }));
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(setupHeading);
    await act(async () => {
      resolvePosition(saved);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(setupHeading);
    expect(statusBar()).toHaveTextContent('Jumped to Setup.');
  });

  it('shows a bookmark under its chosen name, with the heading as the reader sees it', async () => {
    const namedBookmark: VaultBookmark = {
      id: 'bm-named',
      path: 'Note.md',
      title: 'Hello *world*',
      name: 'My section',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Hello *world*', occurrence: 0 },
    };
    const unnamedBookmark: VaultBookmark = {
      id: 'bm-unnamed',
      path: 'Note.md',
      title: 'Hello *world*',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Hello *world*', occurrence: 0 },
    };
    setup([namedBookmark, unnamedBookmark], '# Title\n\n## Hello *world*\n');
    await openNote();
    expect(screen.getByRole('button', { name: 'My section — Note.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hello world — Note.md' })).toBeInTheDocument();
  });

  it('moves the caret to the bookmarked heading in rich-text edit mode', async () => {
    setup([headingBookmark]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    await screen.findByRole('textbox', { name: 'Markdown source' });
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    const editor = await screen.findByRole('textbox', { name: 'Rich text editor' });
    fireEvent.click(screen.getByRole('button', { name: 'Setup — Note.md' }));
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(editor);
    const selection = window.getSelection();
    expect(selection?.anchorNode?.textContent).toBe('Setup');
    expect(selection?.anchorOffset).toBe(0);
    // The heading text is selected, not a collapsed caret on it — and
    // the selection is a text-node range, as Find selects a match.
    expect(selection?.toString()).toBe('Setup');
    expect(selection?.isCollapsed).toBe(false);
    expect(selection?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('lands the caret in the editor when the bookmark opens a note in edit mode', async () => {
    // The note opens through the bookmark click itself, in edit mode by
    // default: the mode settles in a later effect in the same commit, so
    // the jump must wait for the settled view instead of landing on a
    // heading the mode switch then destroys.
    setup([headingBookmark], content, null, { defaultNoteOpenMode: 'edit' });
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('button', { name: 'Setup — Note.md' }));
    const editor = (await screen.findByRole('textbox', {
      name: 'Markdown source',
    })) as HTMLTextAreaElement;
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(setupOffset + 3);
    expect(editor.selectionEnd).toBe(setupOffset + 8);
    // The landing sticks: focus is still in the editor after the mode
    // has settled and the view has re-rendered.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(setupOffset + 3);
    expect(editor.selectionEnd).toBe(setupOffset + 8);
  });

  it('creates a position bookmark with Ctrl+Alt+H from the reading position', async () => {
    const { addBookmark } = setup([headingBookmark]);
    await openNote();
    placeReadingSelection('Details here.');
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    // The reader is in the Setup section, so the bookmark is named for
    // it — but it is a position bookmark at the section's start, not a
    // heading bookmark: Ctrl+Alt+H now sets a position bookmark.
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Setup');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        'Note.md',
        { kind: 'offset', offset: setupOffset },
        'Setup',
        'Setup',
      ),
    );
  });

  it('Ctrl+Alt+J jumps to the next bookmark in reading mode and wraps to the first', async () => {
    const positionBookmark: VaultBookmark = {
      id: 'bm-details',
      path: 'Note.md',
      title: 'Setup',
      name: 'The details',
      created: new Date().toISOString(),
      anchor: { kind: 'offset', offset: content.indexOf('Details here.') },
    };
    setup([headingBookmark, positionBookmark]);
    await openNote();
    // Reading in the Title section: the next bookmark is Setup.
    placeReadingSelection('Intro text.');
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(setupHeading);
    expect(window.getSelection()?.toString()).toBe('Setup');
    // Still on Setup: the next bookmark is the position bookmark in its
    // section. A position bookmark lands on its containing heading in
    // reading mode, as a list activation does — announced under its
    // chosen name.
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to The details.'));
    expect(document.activeElement).toBe(setupHeading);
    expect(window.getSelection()?.toString()).toBe('Setup');
    // Past the last bookmark: J wraps to the first.
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(setupHeading);
    expect(window.getSelection()?.toString()).toBe('Setup');
  });

  it('Ctrl+Alt+J with a single bookmark jumps to it', async () => {
    setup([headingBookmark]);
    await openNote();
    placeReadingSelection('Intro text.');
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(setupHeading);
    // Pressing J again on the only bookmark jumps to it again, not
    // nowhere.
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(setupHeading);
    expect(window.getSelection()?.toString()).toBe('Setup');
  });

  it('Ctrl+Alt+J with no bookmarks says there are none', async () => {
    setup([]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('No bookmarks in this note.'));
  });

  it('Ctrl+Alt+J says there are no bookmarks when only another note has them', async () => {
    const otherBookmark: VaultBookmark = {
      id: 'bm-other',
      path: 'Other.md',
      title: 'Other heading',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Other heading', occurrence: 0 },
    };
    setup([otherBookmark]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('No bookmarks in this note.'));
  });

  it('Ctrl+Alt+J jumps to the next bookmark in edit mode and wraps to the first', async () => {
    const positionBookmark: VaultBookmark = {
      id: 'bm-details',
      path: 'Note.md',
      title: 'Setup',
      name: 'The details',
      created: new Date().toISOString(),
      anchor: { kind: 'offset', offset: content.indexOf('Details here.') },
    };
    setup([headingBookmark, positionBookmark]);
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = (await screen.findByRole('textbox', {
      name: 'Markdown source',
    })) as HTMLTextAreaElement;
    const caret = content.indexOf('Intro text.') + 3;
    editor.selectionStart = caret;
    editor.selectionEnd = caret;
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(setupOffset + 3);
    expect(editor.selectionEnd).toBe(setupOffset + 8);
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to The details.'));
    const lineStart = content.indexOf('Details here.');
    expect(editor.selectionStart).toBe(lineStart);
    expect(editor.selectionEnd).toBe(lineStart + 'Details here.'.length);
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Jumped to Setup.'));
    expect(editor.selectionStart).toBe(setupOffset + 3);
    expect(editor.selectionEnd).toBe(setupOffset + 8);
  });

  it('Ctrl+Alt+J with no note open says to open a note or PDF first', async () => {
    setup([headingBookmark]);
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Open a note or PDF to jump to a bookmark.'));
  });

  it('Ctrl+Alt+H in reading mode with no reading position bookmarks the top of the note', async () => {
    setup([headingBookmark]);
    await openNote();
    window.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    // With no reading position, H sets a position bookmark at the top
    // of the note, named for the first heading.
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Title');
  });

  it('Ctrl+Alt+H in reading mode uses the saved reading position when there is no selection', async () => {
    // H sets a position bookmark at the saved heading's offset, named
    // for that heading — not a heading bookmark.
    setup([headingBookmark], content, {
      path: 'Note.md',
      heading: 'Setup',
      occurrence: 0,
      updated: new Date().toISOString(),
    });
    await openNote();
    // Opening resumes at Setup, which focuses the heading; move focus
    // away and clear the selection so only the saved position remains.
    await waitFor(() => expect(statusBar()).toHaveTextContent('Resumed at Setup.'));
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    // The saved position is Setup, not the first heading.
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Setup');
  });

  it('the heading command in reading mode before the first heading says so instead of bookmarking the wrong heading', async () => {
    // Ctrl+Alt+H no longer sets a heading bookmark, so the "no heading"
    // guard now belongs to the heading command itself, in the Tools menu
    // / command palette.
    const leadContent = 'Intro text.\n\n# Title\n\nBody.\n';
    const { menu } = setup([headingBookmark], leadContent);
    await openNote();
    placeReadingSelection('Intro text.');
    menu('bookmark-heading-at-cursor');
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('No heading at or before the cursor to bookmark.'),
    );
    expect(screen.queryByRole('dialog', { name: 'Name bookmark' })).not.toBeInTheDocument();
  });

  it('Ctrl+Alt+H in reading mode before the first heading bookmarks the position instead', async () => {
    const leadContent = 'Intro text.\n\n# Title\n\nBody.\n';
    const { addBookmark } = setup([headingBookmark], leadContent);
    await openNote();
    placeReadingSelection('Intro text.');
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Name bookmark' });
    expect(within(dialog).getByLabelText('Bookmark name')).toHaveValue('Intro text.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        'Note.md',
        { kind: 'offset', offset: 0 },
        'Intro text.',
        'Intro text.',
      ),
    );
  });

  it("shows only the open note's bookmarks under the Bookmarks heading", async () => {
    // A bookmark for another note used to list alongside the open
    // note's bookmarks, reading as if it belonged to the note on
    // screen. Only the open note's bookmarks are shown, and the list
    // follows the note that becomes current.
    const otherBookmark: VaultBookmark = {
      id: 'bm-other',
      path: 'Other.md',
      title: 'Other heading',
      created: new Date().toISOString(),
      anchor: { kind: 'heading', text: 'Other heading', occurrence: 0 },
    };
    setup(
      [headingBookmark, otherBookmark],
      content,
      null,
      {},
      undefined,
      [
        { name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' },
        { name: 'Other.md', path: 'Other.md', kind: 'note', provenance: 'created' },
      ],
    );
    await screen.findByRole('heading', { name: 'Study' });
    // No note open yet: there is no open file to scope to, so the
    // library's bookmarks show — the list is the way to jump into a
    // closed note at its bookmark.
    expect(screen.getByRole('button', { name: 'Setup — Note.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other heading — Other.md' })).toBeInTheDocument();
    await openNote();
    expect(screen.getByRole('button', { name: 'Setup — Note.md' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Other heading — Other.md' })).not.toBeInTheDocument();
    // Opening the other note flips the list to its bookmarks.
    fireEvent.keyDown(document.body, { key: 'V', ctrlKey: true, shiftKey: true });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Other\.md/ }));
    await screen.findByRole('heading', { name: 'Other', level: 2 });
    expect(screen.getByRole('button', { name: 'Other heading — Other.md' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Setup — Note.md' })).not.toBeInTheDocument();
  });

  it('Ctrl+Alt+H with no note open says to open a note or PDF first', async () => {
    // The keyboard path reaches the bookmark command even when the
    // palette shows it disabled (a preview open, or no note open at
    // all): the shortcut must say so instead of silently doing nothing.
    setup([headingBookmark]);
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true });
    await waitFor(() => expect(statusBar()).toHaveTextContent('Open a note or PDF to set a bookmark.'));
    expect(screen.queryByRole('dialog', { name: 'Name bookmark' })).not.toBeInTheDocument();
  });
});
