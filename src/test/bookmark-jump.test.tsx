import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
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
      expect(statusBar()).toHaveTextContent('Opened at the bookmarked heading.'),
    );
    expect(document.activeElement).toBe(setupHeading);
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
      expect(statusBar()).toHaveTextContent('Opened at the bookmarked place.'),
    );
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(setupOffset);
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
      expect(statusBar()).toHaveTextContent('Opened at the bookmarked heading.'),
    );
    expect(document.activeElement).toBe(setupHeading);
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
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Bookmarked heading "Setup".'),
    );
    menu('bookmark-position-at-cursor');
    await waitFor(() =>
      expect(statusBar()).toHaveTextContent('Bookmarked this position.'),
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
      expect(statusBar()).toHaveTextContent('Opened at the bookmarked place.'),
    );
    expect(editor.selectionStart).toBe(setupOffset);
    // Switching back to reading must keep the reader at the bookmarked
    // heading, not yank it back to the saved reading position.
    menu('toggle-read-only-mode');
    const setupHeading = screen.getByRole('heading', { name: 'Setup' });
    await waitFor(() => expect(document.activeElement).toBe(setupHeading));
    expect(statusBar()).toHaveTextContent('Opened at the bookmarked heading.');
  });

  it('lands focus at the top of the document for a position bookmark with no heading before it', async () => {
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
      expect(statusBar()).toHaveTextContent('Opened at the bookmarked place.'),
    );
    // Focus lands on the reading document itself (the top of the note),
    // not on the side-pane button or the body.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(jumpButton);
    expect(document.activeElement?.contains(screen.getByText('Intro text.'))).toBe(true);
  });
});
