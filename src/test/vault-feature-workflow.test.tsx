import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import type { VaultChangedEvent } from '../shared/search';
import type { VaultReminderEvent } from '../shared/reminders';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup(customBold = false) {
  let content = '# Note\n\ntext';
  let listener: (event: VaultChangedEvent) => void = () => undefined;
  let lock: () => void = () => undefined;
  let reminderListener: (event: VaultReminderEvent) => void = () => undefined;
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note' }],
  };
  const bridge: NotebookBridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => content),
      saveNote: vi.fn(async (_path: string, value: string) => {
        content = value;
      }),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      getTasks: vi.fn(async () => []),
      toggleTask: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      toggleBookmark: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        autosaveDelay: 0,
        shortcuts: customBold ? { 'format-bold': 'Ctrl+Alt+B' } : {},
      })),
      onSecurityLocked: (callback) => {
        lock = callback;
        return () => undefined;
      },
      onReminder: (callback) => {
        reminderListener = callback;
        return () => undefined;
      },
      onChanged: (callback) => {
        listener = callback;
        return () => undefined;
      },
      search: vi.fn(async () => [
        {
          path: 'Note.md',
          title: 'Note',
          kind: 'note' as const,
          notebook: '',
          tags: [],
          modified: '2026-10-03',
          snippet: 'matching text',
          score: 1,
        },
      ]),
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: () => () => undefined,
  };
  window.a11yNotebook = bridge;
  render(<App />);
  return {
    bridge,
    vault,
    lock: () => lock(),
    reminder: (event: VaultReminderEvent) => reminderListener(event),
    external: (disk: string) => {
      content = disk;
      listener({ vaultPath: vault.path, paths: ['Note.md'] });
    },
  };
}

async function editNote() {
  fireEvent.click(await screen.findByRole('treeitem', { name: /Note.md/ }));
  await screen.findByRole('heading', { name: 'Note', level: 2 });
  fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
  return screen.findByRole('textbox', { name: 'Markdown source' });
}

describe('feature wiring in the application shell', () => {
  it('removes reminder content and ignores stale reminder events after locking', async () => {
    const { lock, reminder, vault } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    const item = {
      id: 'private-reminder',
      title: 'Private reminder title',
      path: 'Note.md',
      source: 'standalone' as const,
      status: 'fired' as const,
      scheduledAt: '2020-01-01T12:00:00Z',
      originalScheduledAt: '2020-01-01T12:00:00Z',
    };
    act(() => reminder({ type: 'changed', vaultPath: vault.path, reminders: [item] }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Reminders' }));
    expect(screen.getByRole('button', { name: item.title })).toBeInTheDocument();
    act(() => lock());
    expect(screen.getByRole('dialog', { name: 'Vault locked' })).toBeInTheDocument();
    expect(screen.queryByText(item.title)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reminders' })).not.toBeInTheDocument();
    act(() => reminder({ type: 'fired', vaultPath: vault.path, reminder: item }));
    expect(screen.queryByText(`Reminder: ${item.title}`)).not.toBeInTheDocument();
  });
  it('ignores an old-vault refresh that finishes after opening a different vault', async () => {
    const { bridge, vault } = setup();
    const editor = await editNote();
    const next: VaultInfo = {
      name: 'Next',
      path: '/next',
      entries: [{ name: 'Other.md', path: 'Other.md', kind: 'note' }],
    };
    let finish: (value: VaultInfo) => void = () => undefined;
    vi.mocked(bridge.vault.get)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue(next);
    vi.mocked(bridge.vault.open).mockResolvedValue(next);
    fireEvent.change(editor, { target: { value: 'Saved content' } });
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    await waitFor(() => expect(bridge.vault.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Open vault' }));
    await screen.findByRole('treeitem', { name: /Other.md/ });
    await act(async () => finish(vault));
    expect(screen.getByRole('treeitem', { name: /Other.md/ })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: /Note.md/ })).not.toBeInTheDocument();
  });
  it('pauses editing while a new vault is initialized', async () => {
    const { bridge } = setup();
    const editor = await editNote();
    let finish: (vault: VaultInfo | null) => void = () => undefined;
    vi.mocked(bridge.vault.open).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open vault' }));
    await screen.findByRole('dialog', { name: 'Opening vault' });
    expect(editor).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'late edit' } });
    expect(editor).toHaveValue('# Note\n\ntext');
    await act(async () => finish(null));
    expect(editor).not.toBeDisabled();
    expect(editor).toHaveValue('# Note\n\ntext');
  });
  it('opens a labelled creation dialog instead of a browser prompt', async () => {
    const { bridge } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    const dialog = screen.getByRole('dialog', { name: 'New note' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'New' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New note' }));
    await waitFor(() => expect(bridge.vault.createNote).toHaveBeenCalledWith('New.md'));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
  it('uses the customizable registry shortcut rather than a hardcoded formatting listener', async () => {
    setup(true);
    const editor = (await editNote()) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(editor.value.indexOf('text'), editor.value.length);
    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
    expect(editor).toHaveValue('# Note\n\ntext');
    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true, altKey: true });
    await waitFor(() => expect(editor).toHaveValue('# Note\n\n**text**'));
  });
  it('queries the index after debounce and does not scan note contents in the renderer', async () => {
    const { bridge } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Global search' }), { target: { value: 'text' } });
    expect(bridge.vault.search).not.toHaveBeenCalled();
    await waitFor(() => expect(bridge.vault.search).toHaveBeenCalledWith({ text: 'text', limit: 100 }));
    expect(bridge.vault.readNote).not.toHaveBeenCalled();
    expect(await screen.findByText('matching text')).toBeInTheDocument();
  });
  it('preserves dirty edits and resolves an external conflict through Load disk version', async () => {
    const { bridge, external } = setup();
    const editor = await editNote();
    fireEvent.change(editor, { target: { value: 'mine' } });
    act(() => external('disk version'));
    const dialog = await screen.findByRole('dialog', { name: 'Note changed on disk' });
    expect(editor).toHaveValue('mine');
    expect(bridge.vault.saveNote).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load disk version' }));
    await waitFor(() => expect(editor).toHaveValue('disk version'));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
  it('opens and dismisses the keyboard tree menu without moving to another item', async () => {
    setup();
    const item = await screen.findByRole('treeitem', { name: /Note.md/ });
    item.focus();
    fireEvent.keyDown(item, { key: 'F10', shiftKey: true });
    const menu = screen.getByRole('menu', { name: 'Actions for Note.md' });
    expect(within(menu).getByRole('menuitem', { name: 'New note' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(within(menu).getByRole('menuitem', { name: 'Bookmark' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(item).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });
});
