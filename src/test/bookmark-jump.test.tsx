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
) {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
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
      getReadingPosition: vi.fn(async () => savedPosition),
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
      installOnExit: vi.fn(),
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
    // The heading text is selected, not a collapsed caret on it.
    expect(selection?.toString()).toBe('Setup');
    expect(selection?.isCollapsed).toBe(false);
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
});
