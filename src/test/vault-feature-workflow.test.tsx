import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo, VaultTask } from '../shared/types';
import type { VaultChangedEvent } from '../shared/search';
import type { VaultReminderEvent } from '../shared/reminders';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup(
  customBold = false,
  note?: { path: string; content: string; tasks: VaultTask[] },
  options: {
    noteEditLockMinutes?: number;
    protectedVault?: boolean;
    failSettingsAfterUnlock?: boolean;
  } = {},
) {
  let content = note?.content ?? '# Note\n\ntext';
  let unlocked = !options.protectedVault;
  let listener: (event: VaultChangedEvent) => void = () => undefined;
  let lock: () => void = () => undefined;
  let reminderListener: (event: VaultReminderEvent) => void = () => undefined;
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: note?.path.split('/').at(-1) ?? 'Note.md', path: note?.path ?? 'Note.md', kind: 'note' }],
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
      getTasks: vi.fn(async () => note?.tasks ?? []),
      toggleTask: vi.fn(async (_path: string, _location: string | number, complete: boolean) => {
        if (note?.path.endsWith('.html')) {
          content = content.replace(
            /data-a11y-task-complete="(?:true|false)"/,
            `data-a11y-task-complete="${complete}"`,
          );
        }
        return (note?.tasks ?? []).map((task) => ({ ...task, complete }));
      }),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      toggleBookmark: vi.fn(async () => []),
      getSettings: vi.fn(async () => {
        if (!unlocked || options.failSettingsAfterUnlock) throw new Error('Settings unavailable.');
        return {
          ...DEFAULT_SETTINGS,
          autosaveDelay: 0,
          noteEditLockMinutes: options.noteEditLockMinutes ?? 0,
          theme: options.protectedVault ? ('dark' as const) : DEFAULT_SETTINGS.theme,
          shortcuts: customBold ? { 'format-bold': 'Ctrl+Alt+B' } : {},
        };
      }),
      getSecurityStatus: vi.fn(async () => ({
        enabled: !!options.protectedVault,
        locked: !unlocked,
        recoveryAvailable: false,
      })),
      unlockVault: vi.fn(async () => {
        unlocked = true;
        return vault;
      }),
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
    readContent: () => content,
  };
}

async function editNote() {
  fireEvent.click(await screen.findByRole('treeitem', { name: /Note.md/ }));
  await screen.findByRole('heading', { name: 'Note', level: 2 });
  fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
  return screen.findByRole('textbox', { name: 'Markdown source' });
}

describe('feature wiring in the application shell', () => {
  it('keeps timed-out dirty notes locked across tab switches and failed saves, clearing only after a successful save', async () => {
    const { bridge } = setup(false, undefined, { noteEditLockMinutes: 1 });
    const editor = await editNote();
    vi.useFakeTimers();
    try {
      fireEvent.change(editor, { target: { value: 'unsaved change' } });
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      fireEvent.click(screen.getByRole('tab', { name: 'Welcome' }));
      fireEvent.click(screen.getByRole('tab', { name: /Note/ }));
      fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
      expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
      vi.mocked(bridge.vault.saveNote).mockRejectedValueOnce(new Error('Disk full.'));
      await act(async () => {
        fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
      });
      fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
      expect(screen.queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
      });
      fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
      expect(screen.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('unsaved change');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    'reloads settings after unlock without treating a settings failure as an unlock failure (%s)',
    async (failure) => {
      const { bridge } = setup(false, undefined, { protectedVault: true, failSettingsAfterUnlock: failure });
      await screen.findByRole('dialog', { name: 'Vault locked' });
      const before = vi.mocked(bridge.vault.getSettings).mock.calls.length;
      fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'correct horse battery' } });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }));
      await waitFor(() => expect(bridge.vault.getSettings).toHaveBeenCalledTimes(before + 1));
      expect(screen.queryByRole('dialog', { name: 'Vault locked' })).not.toBeInTheDocument();
      if (!failure) await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
      else await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not load settings.'));
    },
  );

  it('creates HTML notes from the format picker', async () => {
    const { bridge } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    const dialog = await screen.findByRole('dialog', { name: 'New note' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Briefing' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Note format' }), { target: { value: 'html' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New note' }));
    await waitFor(() => expect(bridge.vault.createNote).toHaveBeenCalledWith('Briefing.html'));
  });
  it('renders HTML task semantics accessibly and toggles by stable task identity', async () => {
    const task: VaultTask = {
      id: 'Note.html#task-1234',
      path: 'Note.html',
      taskId: 'task-1234',
      htmlTask: true,
      revision: 'a'.repeat(64),
      text: 'Read chapter',
      complete: false,
      dueDate: '2026-10-05',
      priority: 'high',
    };
    const { bridge, readContent } = setup(false, {
      path: 'Note.html',
      content:
        '<h1>Note</h1><ul><li data-a11y-task-id="task-1234" data-a11y-task-complete="false">Read chapter</li></ul>',
      tasks: [task],
    });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Note\.html/ }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Mark complete: Read chapter' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(bridge.vault.toggleTask).toHaveBeenCalledWith('Note.html', 'task-1234', true, 'a'.repeat(64)),
    );
    expect(await screen.findByRole('checkbox', { name: 'Mark incomplete: Read chapter' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(readContent()).not.toContain('data-a11y-task-complete="false"');
  });

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
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(within(menu).getByRole('menuitem', { name: 'Export note…' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(item).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });
});
