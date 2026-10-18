import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import EditorTools, { type EditorToolsHandle } from '../renderer/features/editor/EditorTools';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

function installBridge(showCommandButtons?: boolean) {
  let listener: ((command: MenuCommand) => void) | undefined;
  const vault = {
    name: 'Study library',
    path: '/study',
    entries: [{ name: 'Idea.md', path: 'Idea.md', kind: 'note' as const, provenance: 'created' as const }],
  };
  const bridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => vault),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons, autosaveDelay: 0 })),
      readNote: vi.fn(async () => '# Idea'),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  return {
    bridge,
    menu: (command: MenuCommand) => act(() => listener?.(command)),
  };
}

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

describe('command surface visibility', () => {
  it.each([undefined, false])(
    'hides duplicate desktop command strips for preference %s, not navigation or content',
    async (preference) => {
      const { menu, bridge } = installBridge(preference);
      const { container } = render(<App />);
      await screen.findByRole('heading', { name: 'Study library' });
      expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument();
      expect(container.querySelector('.vault-actions')).toBeNull();
      expect(screen.getByRole('searchbox', { name: 'Global search' })).toBeInTheDocument();
      expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument();
      expect(screen.getByRole('treeitem', { name: /Idea\.md/ })).toBeInTheDocument();

      menu('show-libraries');
      expect(screen.queryByRole('button', { name: 'New library' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open library' })).not.toBeInTheDocument();
      menu('show-tasks');
      expect(screen.getByRole('combobox', { name: 'Task status' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();

      menu('show-about');
      expect(screen.getByRole('dialog', { name: 'About A11y Notebook' })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      const note = screen.getByRole('treeitem', { name: /Idea\.md/ });
      fireEvent.keyDown(note, { key: 'Enter' });
      await screen.findByRole('heading', { name: 'Idea', level: 2 });
      menu('toggle-read-only-mode');
      expect(screen.queryByRole('toolbar', { name: 'Markdown formatting' })).not.toBeInTheDocument();
      const editor = screen.getByRole('textbox', { name: 'Markdown source' });
      fireEvent.change(editor, { target: { value: '# Updated' } });
      menu('save-current-note');
      await waitFor(() => expect(bridge.vault.saveNote).toHaveBeenCalledWith('Idea.md', '# Updated', '# Idea'));
    },
  );

  it('restores existing desktop buttons when enabled, using the same command handlers', async () => {
    const { menu } = installBridge(true);
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    await screen.findByRole('navigation', { name: 'Main menu' });
    expect(container.querySelector('.vault-actions')).not.toBeNull();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Help' })).getByRole('button', { name: 'About A11y Notebook' }),
    );
    expect(screen.getByRole('dialog', { name: 'About A11y Notebook' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    menu('show-libraries');
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Open library' })).toBeInTheDocument();
  });

  it('keeps accessible command buttons in browser preview without a native menu', () => {
    render(<App />);
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Help' })).getByRole('button', { name: 'About A11y Notebook' }),
    );
    expect(screen.getByRole('dialog', { name: 'About A11y Notebook' })).toBeInTheDocument();
  });

  it('applies saved visibility changes immediately without losing native Settings access', async () => {
    const { bridge, menu } = installBridge(false);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    for (const enabled of [true, false]) {
      menu('show-settings');
      const dialog = screen.getByRole('dialog', { name: 'Settings' });
      const checkbox = within(dialog).getByRole('checkbox', { name: 'Show command/action buttons in the UI' });
      expect(checkbox).toHaveProperty('checked', !enabled);
      fireEvent.click(checkbox);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(Boolean(screen.queryByRole('navigation', { name: 'Main menu' }))).toBe(enabled);
      expect(bridge.vault.saveSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ showCommandButtons: enabled }),
      );
    }
  });

  it('connects Settings shortcut capture and cleanup to the narrow native bridge', async () => {
    const { bridge, menu } = installBridge(false);
    const view = render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    menu('show-settings');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /capture/i })[0]);
    expect(bridge.setShortcutCaptureActive).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(bridge.setShortcutCaptureActive).toHaveBeenLastCalledWith(false);
  });

  it('keeps editor command handlers and insertion dialogs mounted when the formatting strip is hidden', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();
    const toolsRef = createRef<EditorToolsHandle>();
    const onContentChange = vi.fn();
    render(
      <>
        <textarea aria-label="Editor" ref={textareaRef} defaultValue="word" />
        <EditorTools
          ref={toolsRef}
          textareaRef={textareaRef}
          notePaths={[]}
          announce={vi.fn()}
          onContentChange={onContentChange}
          showCommandButtons={false}
        />
      </>,
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    textareaRef.current!.setSelectionRange(0, 4);
    act(() => toolsRef.current!.format('bold'));
    expect(onContentChange).toHaveBeenCalledWith('**word**');
    act(() => toolsRef.current!.openTable());
    const dialog = screen.getByRole('dialog', { name: 'Insert table' });
    expect(within(dialog).getByRole('spinbutton', { name: 'Body rows' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeInTheDocument();
  });
});
