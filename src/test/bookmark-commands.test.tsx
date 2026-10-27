import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

describe('bookmark commands', () => {
  it('bookmarks the heading and the position at the edit caret through the command palette path', async () => {
    const content = '# Title\n\nIntro text.\n\n## Setup\n\nDetails here.\n';
    const vault: VaultInfo = {
      name: 'Study',
      path: '/study',
      entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
    };
    let menuListener: (command: MenuCommand) => void = () => undefined;
    const addBookmark = vi.fn(async () => []);
    const bridge = {
      vault: {
        ...vaultExtensions(),
        open: vi.fn(async () => vault),
        get: vi.fn(async () => vault),
        readNote: vi.fn(async () => content),
        saveNote: vi.fn(async () => undefined),
        getTasks: vi.fn(async () => []),
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
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
    fireEvent.click(await screen.findByRole('treeitem', { name: /Note\.md/ }));
    await screen.findByRole('heading', { name: 'Note', level: 2 });
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    const caret = content.indexOf('Details here.') + 3;
    editor.selectionStart = caret;
    editor.selectionEnd = caret;

    act(() => menuListener('bookmark-heading-at-cursor'));
    await vi.waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith('Note.md', { kind: 'heading', text: 'Setup', occurrence: 0 }),
    );

    act(() => menuListener('bookmark-position-at-cursor'));
    await vi.waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith('Note.md', { kind: 'offset', offset: caret }),
    );
  });
});
