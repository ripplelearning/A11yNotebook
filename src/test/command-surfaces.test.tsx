import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import EditorTools, { type EditorToolsHandle } from '../renderer/features/editor/EditorTools';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

function installBridge(showCommandButtons?: boolean) {
  let listener: ((command: MenuCommand) => void) | undefined;
  const vault: VaultInfo = {
    name: 'Study library',
    path: '/study',
    entries: [
      { name: 'Idea.md', path: 'Idea.md', kind: 'note', provenance: 'created' },
      { name: 'Research', path: 'Research', kind: 'notebook', children: [] },
    ],
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
      importFile: vi.fn(async (): Promise<VaultInfo | null> => null),
      openExternal: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  return {
    bridge,
    vault,
    menu: (command: MenuCommand) => act(() => listener?.(command)),
  };
}

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

describe('command surface visibility', () => {
  it.each(['menu', 'palette', 'sidebar'] as const)(
    'opens managed Markdown and HTML notes externally through the %s command surface',
    async (surface) => {
      const { menu, bridge, vault } = installBridge(surface === 'sidebar');
      vault.entries.push({ name: 'Page.html', path: 'Page.html', kind: 'note', provenance: 'created' });
      const { container } = render(<App />);
      await screen.findByRole('heading', { name: 'Study library' });
      if (surface !== 'sidebar') expect(container.querySelector('.vault-actions')).toBeNull();
      for (const path of ['Idea.md', 'Page.html']) {
        fireEvent.click(screen.getByRole('treeitem', { name: new RegExp(path.replace('.', '\\.')) }));
        if (surface === 'menu') menu('open-selected-external');
        else {
          if (surface === 'palette') menu('command-search');
          const commands =
            surface === 'sidebar' ? within(screen.getByRole('complementary', { name: 'Navigation pane' })) : screen;
          fireEvent.click(commands.getByRole('button', { name: 'Open in external app' }));
        }
        await waitFor(() => expect(bridge.vault.openExternal).toHaveBeenLastCalledWith(path));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
      expect(bridge.vault.openExternal).toHaveBeenCalledTimes(2);
    },
  );

  it('disables external opening without a file selection and guards native commands during dialogs', async () => {
    const { menu, bridge } = installBridge(false);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    for (const selectNotebook of [false, true]) {
      if (selectNotebook) fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
      menu('command-search');
      expect(screen.getByRole('button', { name: 'Open in external app' })).toBeDisabled();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      menu('open-selected-external');
      expect(bridge.vault.openExternal).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole('treeitem', { name: /Idea\.md/ }));
    menu('show-about');
    menu('open-selected-external');
    expect(bridge.vault.openExternal).not.toHaveBeenCalled();
  });

  it('reports rejected import and external-open commands without unhandled rejections', async () => {
    const { menu, bridge } = installBridge(false);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    bridge.vault.importFile.mockRejectedValueOnce(new Error('Import denied'));
    menu('import-file');
    await waitFor(() =>
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('Could not import the selected file.'),
    );
    fireEvent.click(screen.getByRole('treeitem', { name: /Idea\.md/ }));
    bridge.vault.openExternal.mockRejectedValueOnce(new Error('Encrypted note'));
    menu('open-selected-external');
    await waitFor(() =>
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('Could not open the selected file externally.'),
    );
  });

  it.each(['menu', 'palette', 'sidebar'] as const)(
    'imports an external file into the selected notebook through the %s command surface',
    async (surface) => {
      const { menu, bridge, vault } = installBridge(surface === 'sidebar');
      const { container } = render(<App />);
      await screen.findByRole('heading', { name: 'Study library' });
      if (surface !== 'sidebar') expect(container.querySelector('.vault-actions')).toBeNull();
      fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
      bridge.vault.importFile.mockResolvedValueOnce({
        ...vault,
        entries: [
          vault.entries[0],
          {
            ...vault.entries[1],
            children: [
              { name: 'External.pdf', path: 'Research/External.pdf', kind: 'attachment', provenance: 'imported' },
            ],
          },
        ],
      });
      const runImport = () => {
        if (surface === 'menu') menu('import-file');
        else {
          if (surface === 'palette') menu('command-search');
          const commands =
            surface === 'sidebar' ? within(screen.getByRole('complementary', { name: 'Navigation pane' })) : screen;
          fireEvent.click(commands.getByRole('button', { name: 'Import file' }));
        }
      };
      runImport();
      await waitFor(() => expect(bridge.vault.importFile).toHaveBeenCalledExactlyOnceWith('Research'));
      await waitFor(() =>
        expect(screen.getByRole('treeitem', { name: /Research/ })).toHaveAttribute('aria-expanded', 'false'),
      );
      fireEvent.keyDown(screen.getByRole('treeitem', { name: /Research/ }), { key: 'ArrowRight' });
      expect(await screen.findByRole('treeitem', { name: /External\.pdf/ })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      runImport();
      await waitFor(() => expect(bridge.vault.importFile).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('treeitem', { name: /External\.pdf/ })).toBeInTheDocument();
    },
  );

  it('disables external import without a selected notebook and guards native commands during dialogs', async () => {
    const { menu, bridge } = installBridge(false);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    for (const selectNote of [false, true]) {
      if (selectNote) fireEvent.click(screen.getByRole('treeitem', { name: /Idea\.md/ }));
      menu('command-search');
      expect(screen.getByRole('button', { name: 'Import file' })).toBeDisabled();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      menu('import-file');
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('Select a notebook before importing a file.');
      expect(bridge.vault.importFile).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole('treeitem', { name: /Research/ }));
    menu('show-about');
    menu('import-file');
    expect(bridge.vault.importFile).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'About A11y Notebook' })).toBeInTheDocument();
  });

  it.each([undefined, false])(
    'hides duplicate desktop command strips for preference %s, not navigation or content',
    async (preference) => {
      const { menu, bridge } = installBridge(preference);
      const { container } = render(<App />);
      await screen.findByRole('heading', { name: 'Study library' });
      expect(screen.queryByRole('navigation', { name: 'Application commands' })).not.toBeInTheDocument();
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
    await screen.findByRole('navigation', { name: 'Application commands' });
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
    expect(screen.getByRole('navigation', { name: 'Application commands' })).toBeInTheDocument();
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
      expect(Boolean(screen.queryByRole('navigation', { name: 'Application commands' }))).toBe(enabled);
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

  it('suppresses App keyboard and native commands while capturing, then consumes only the first Escape', async () => {
    const { bridge, menu } = installBridge(false);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    menu('show-settings');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const capture = within(dialog).getByRole('button', { name: 'Capture Shortcut for Save note' });
    capture.focus();
    fireEvent.click(capture);
    expect(bridge.setShortcutCaptureActive).toHaveBeenLastCalledWith(true);

    expect(fireEvent.keyDown(capture, { key: 'k', ctrlKey: true })).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(dialog);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(bridge.setShortcutCaptureActive).toHaveBeenLastCalledWith(true);
    menu('show-about');
    expect(screen.queryByRole('dialog', { name: 'About A11y Notebook' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(dialog);

    fireEvent.keyDown(capture, { key: 'Escape' });
    expect(bridge.setShortcutCaptureActive).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
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
