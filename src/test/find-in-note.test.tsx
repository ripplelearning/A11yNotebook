import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
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
        children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' }],
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
      readNote: vi.fn(async () => '# Idea\n\nIdea again'),
      readAttachment: vi.fn(async () => ({ path: 'Research/Idea.md', text: 'Idea', kind: 'text' })),
      rename: vi.fn(),
      delete: vi.fn(),
      open: vi.fn(),
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

async function openNote() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
  fireEvent.click(screen.getByRole('treeitem', { name: /Idea\.md/ }));
  await screen.findByText('Idea again');
}

describe('find in note', () => {
  it('finds matches in the reading view and wraps around', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('find-in-note');
    expect(screen.getByRole('dialog', { name: 'Find in note' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in note' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(within(screen.getByRole('dialog', { name: 'Find in note' })).getByRole('status')).toHaveTextContent('Match 1 of 2 for "Idea".');
    expect(window.getSelection()?.toString()).toBe('Idea');
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(within(screen.getByRole('dialog', { name: 'Find in note' })).getByRole('status')).toHaveTextContent('Match 2 of 2 for "Idea".');
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(within(screen.getByRole('dialog', { name: 'Find in note' })).getByRole('status')).toHaveTextContent('Match 1 of 2 for "Idea".');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Find in note' })).not.toBeInTheDocument();
  });

  it('finds matches in the editor and selects them', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('toggle-read-only-mode');
    const editor = (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
    menu('find-in-note');
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in note' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(within(screen.getByRole('dialog', { name: 'Find in note' })).getByRole('status')).toHaveTextContent('Match 1 of 2 for "Idea".');
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(6);
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(editor.selectionStart).toBe(8);
    expect(editor.selectionEnd).toBe(12);
  });

  it('enables reading mode directly while Ctrl+E still toggles', async () => {
    const { menu } = renderLibrary();
    await openNote();
    menu('toggle-read-only-mode');
    expect(await screen.findByRole('textbox', { name: 'Markdown source' })).toBeInTheDocument();
    menu('enable-reading-mode');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument(),
    );
    menu('toggle-read-only-mode');
    expect(await screen.findByRole('textbox', { name: 'Markdown source' })).toBeInTheDocument();
  });
});
