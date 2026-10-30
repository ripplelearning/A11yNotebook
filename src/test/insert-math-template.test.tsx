import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup() {
  const content = 'Before text here.';
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
  };
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => content),
      saveNote: vi.fn(async () => undefined),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getCalendar: vi.fn(async () => []),
      saveCalendar: vi.fn(async (appointments: unknown) => appointments),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      unlockVault: vi.fn(async () => vault),
      onSecurityLocked: () => () => undefined,
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
      search: vi.fn(async () => []),
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: () => () => undefined,
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  render(<App />);
}

describe('insert-math template', () => {
  it('inserts an empty math template with the caret just before the closing backtick', async () => {
    setup();
    fireEvent.click(await screen.findByRole('treeitem', { name: /Note.md/ }));
    await screen.findByRole('heading', { name: 'Note', level: 2 });
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    editor.focus();
    // Place the caret after "Before " (position 7).
    (editor as HTMLTextAreaElement).setSelectionRange(7, 7);
    fireEvent.keyDown(editor, { key: '=', altKey: true });
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('`math:`'));
    expect((editor as HTMLTextAreaElement).value).toBe('Before `math:`text here.');
    // The caret lands inside the template, just before the closing
    // backtick, so typing fills the empty template instead of appending
    // after it. The placement runs on a timer after the content update.
    await waitFor(() =>
      expect((editor as HTMLTextAreaElement).selectionStart).toBe('Before `math:'.length),
    );
    expect(document.activeElement).toBe(editor);
  });
});
