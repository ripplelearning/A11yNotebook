import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import type { VaultChangedEvent } from '../shared/search';
import type { VaultReminderEvent } from '../shared/reminders';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';
import { openTreeLeaf } from './library-navigation';

afterEach(() => {
  delete window.a11yNotebook;
  vi.useRealTimers();
});

/**
 * Setup modeled on vault-feature-workflow.test.tsx, with two changes:
 * the autosave delay is the real 900 ms, and saveNote stays in flight
 * until resolveSaves() is called, so the test can hold a manual save
 * open across the autosave deadline.
 */
function setup() {
  let content = '# Note\n\ntext';
  let unlocked = true;
  const changedListeners = new Set<(event: VaultChangedEvent) => void>();
  let menuListener: (command: MenuCommand) => void = () => undefined;
  let lock: () => void = () => undefined;
  const reminderListeners = new Set<(event: VaultReminderEvent) => void>();
  const saveNoteResolvers: Array<() => void> = [];
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [
      {
        name: 'Note.md',
        path: 'Note.md',
        kind: 'note',
        provenance: 'created',
      },
    ],
  };
  const bridge: NotebookBridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => content),
      saveNote: vi.fn(async (_path: string, value: string) => {
        content = value;
        return new Promise<void>((resolve) => {
          saveNoteResolvers.push(resolve);
        });
      }),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      deletePermanently: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      getTasks: vi.fn(async () => []),
      toggleTask: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      lookupThesaurus: vi.fn(async () => []),
      getBibliography: vi.fn(async () => []),
      saveBibliography: vi.fn(async () => []),
      getCalendar: vi.fn(async () => []),
      saveCalendar: vi.fn(async (appointments) => appointments),
      fetchCitationMetadata: vi.fn(async () => ({})),
      toggleBookmark: vi.fn(async () => []),
      addBookmark: vi.fn(async () => []),
      removeBookmark: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        showCommandButtons: true,
        autosaveDelay: 900,
        reminderAlerts: false,
        noteEditLockMinutes: 0,
      })),
      getSecurityStatus: vi.fn(async () => ({
        enabled: false,
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
        reminderListeners.add(callback);
        return () => {
          reminderListeners.delete(callback);
        };
      },
      onChanged: (callback) => {
        changedListeners.add(callback);
        return () => {
          changedListeners.delete(callback);
        };
      },
      search: vi.fn(async () => [
        {
          path: 'Note.md',
          title: 'Note',
          kind: 'note' as const,
          provenance: 'created' as const,
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
      onStatus: () => () => undefined,
    },
    onMenuCommand: (callback) => {
      menuListener = callback;
      return () => {
        menuListener = () => undefined;
      };
    },
  };
  window.a11yNotebook = bridge;
  render(<App />);
  return {
    bridge,
    vault,
    menu: (command: MenuCommand) => act(() => menuListener(command)),
    lock: () => lock(),
    reminder: (event: VaultReminderEvent) => reminderListeners.forEach((callback) => callback(event)),
    readContent: () => content,
    resolveSaves: () => {
      saveNoteResolvers.splice(0).forEach((resolve) => resolve());
    },
  };
}

async function editNote() {
  await screen.findByRole('heading', { name: 'Study' });
  await openTreeLeaf(/Note\.md/);
  await screen.findByRole('heading', { name: 'Note', level: 2 });
  fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
  return screen.findByRole('textbox', { name: 'Markdown source' });
}

describe('autosave/manual-save race', () => {
  it('a manual save just before the autosave deadline cancels the pending autosave', async () => {
    const { bridge, resolveSaves } = setup();
    const editor = await editNote();
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'edited' } });
    await vi.advanceTimersByTimeAsync(800);
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    // The manual save is still in flight: its saveNote promise is
    // deferred, so the note has not re-rendered as saved yet and the
    // autosave effect's cleanup has not run.
    await vi.advanceTimersByTimeAsync(200);
    // Past the 900 ms autosave deadline. Without the fix the stale
    // autosave fires here and saveNote is called a second time with
    // the pre-save baseline, which the main process would reject as
    // "Note changed on disk".
    expect(bridge.vault.saveNote).toHaveBeenCalledTimes(1);
    expect(bridge.vault.saveNote).toHaveBeenCalledWith('Note.md', 'edited', '# Note\n\ntext');
    // Let the manual save finish and confirm it reports success with
    // no conflict dialog.
    await act(async () => {
      resolveSaves();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('dialog', { name: 'Note changed on disk' })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent('Saved Note.');
  });
});
