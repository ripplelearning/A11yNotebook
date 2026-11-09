// Ctrl+Tab cycles open tabs only: the selected notebook's Notes and
// Files stop, open view tabs, the attachment, and open notes. The
// generic navigation screens, settings, and dialogs are never stops,
// and a closed item leaves the cycle at once.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
  window.localStorage.clear();
});

function renderLibrary() {
  const vault: VaultInfo = {
    name: 'Study',
    path: 'C:/Study',
    entries: [
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [
          { name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' },
          { name: 'Second.md', path: 'Research/Second.md', kind: 'note', provenance: 'created' },
        ],
      },
    ],
  };
  let menuListener: ((command: MenuCommand) => void) | undefined;
  const bridge = {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => vault),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async (notePath: string) => (notePath.endsWith('Idea.md') ? '# Idea' : '# Second')),
      onSecurityLocked: vi.fn(() => () => undefined),
      unlockVault: vi.fn(async () => vault),
    },
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = undefined;
      };
    },
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  render(<App />);
  return { menu: (command: MenuCommand) => act(() => menuListener?.(command)) };
}

async function openIdea() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.keyDown(document, { key: '2', ctrlKey: true });
  fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
  const grid = screen.getByRole('grid', { name: 'Notes and files' });
  fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
}

async function openSecond() {
  const asideGrid = screen.getByRole('grid', { name: 'Notes and files' });
  fireEvent.keyDown(within(asideGrid).getByRole('gridcell', { name: 'Second.md' }), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true'));
}

function statusText() {
  const statusBar = screen.getByRole('contentinfo', { name: 'Status bar' });
  return within(statusBar).getByRole('status').textContent ?? '';
}

describe('Ctrl+Tab cycle', () => {
  it('cycles notebook stop, tasks, and notes, and Shift+Tab reverses', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    await openSecond();
    menu('show-tasks');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true'));
    // Cycle order: notebook stop, Tasks, Idea, Second.
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    expect(statusText()).toBe('Idea');
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Notes & Files' })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(statusText()).toBe('Notes and Files in Research');
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Notes & Files' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('drops a closed note from the cycle', async () => {
    renderLibrary();
    await openIdea();
    await openSecond();
    fireEvent.click(screen.getByRole('button', { name: 'Close Second' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Second' })).not.toBeInTheDocument());
    // Closing the current note returns to the notebook stop. From
    // there the cycle goes straight to Idea, never to Second.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Notes & Files' })).toHaveAttribute('aria-selected', 'true'),
    );
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Notes & Files' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('keeps an edited note unsaved and in edit mode across the cycle', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Idea edited' } });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Idea (unsaved)' })).toHaveAttribute('aria-selected', 'true'),
    );
    menu('show-tasks');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Idea (unsaved)' })).toHaveAttribute('aria-selected', 'true'),
    );
    const editorAfter = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editorAfter.value).toBe('# Idea edited');
  });

  it('restores the edit caret across the cycle', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    editor.selectionStart = 4;
    editor.selectionEnd = 4;
    fireEvent.select(editor);
    menu('show-tasks');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    const editorAfter = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editorAfter.selectionStart).toBe(4);
    expect(editorAfter.selectionEnd).toBe(4);
  });

  it('moves focus into the editor when toggling to edit mode, but not on Ctrl+Tab back to it', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editor).toHaveFocus();
    menu('show-tasks');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'),
    );
    const editorAfter = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editorAfter).not.toHaveFocus();
  });

  it('moves focus into the rich-text editor when that form is active', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    await screen.findByRole('textbox', { name: 'Markdown source' });
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    await screen.findByRole('textbox', { name: 'Rich text editor' });
    menu('toggle-read-only-mode');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Rich text editor' })).not.toBeInTheDocument(),
    );
    menu('toggle-read-only-mode');
    const richEditor = (await screen.findByRole('textbox', { name: 'Rich text editor' })) as HTMLElement;
    expect(richEditor).toHaveFocus();
  });

  it('keeps the caret across a mode toggle', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    editor.selectionStart = 3;
    editor.selectionEnd = 3;
    fireEvent.select(editor);
    menu('toggle-read-only-mode');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument(),
    );
    menu('toggle-read-only-mode');
    const editorAfter = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editorAfter.selectionStart).toBe(3);
    expect(editorAfter.selectionEnd).toBe(3);
  });

  it('restores the Find match caret across the cycle', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    menu('find-in-document');
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in document' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(6);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Find in document' }), { key: 'Escape' });
    menu('show-tasks');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    const editorAfter = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editorAfter.selectionStart).toBe(2);
    expect(editorAfter.selectionEnd).toBe(6);
  });

  it('forgets the caret of a closed note', async () => {
    const { menu } = renderLibrary();
    await openIdea();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    editor.selectionStart = 4;
    editor.selectionEnd = 4;
    fireEvent.select(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Close Idea' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Idea' })).not.toBeInTheDocument());
    const asideGrid = screen.getByRole('grid', { name: 'Notes and files' });
    fireEvent.keyDown(within(asideGrid).getByRole('gridcell', { name: 'Idea.md' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true'));
    menu('toggle-read-only-mode');
    const editorAfter = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    expect(editorAfter.selectionStart).toBe(0);
    expect(editorAfter.selectionEnd).toBe(0);
  });

  it('reports an empty cycle instead of failing', async () => {
    renderLibrary();
    await screen.findByRole('heading', { name: 'Study', level: 2 });
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(statusText()).toBe('No open tabs to cycle to.'));
  });
});
