import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { Milestone } from '../shared/milestones';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup(withNote = false) {
  const vault: VaultInfo = {
    path: '/vault',
    name: 'Planning',
    entries: withNote ? [{ path: 'Plan.md', name: 'Plan.md', kind: 'note' }] : [],
  };
  let menu: (command: MenuCommand) => void = () => undefined;
  const locks = new Set<() => void>();
  const bridge: NotebookBridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      createNote: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      readNote: vi.fn(async () => ''),
      saveNote: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      getTasks: vi.fn(async () => []),
      toggleTask: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      toggleBookmark: vi.fn(async () => []),
      getMilestones: vi.fn(async () => []),
      createMilestone: vi.fn(),
      updateMilestone: vi.fn(),
      deleteMilestone: vi.fn(async () => undefined),
      getSecurityStatus: vi.fn(async () => ({ enabled: true, locked: false, recoveryAvailable: false })),
      unlockVault: vi.fn(async () => vault),
      onSecurityLocked: (callback) => {
        locks.add(callback);
        return () => {
          locks.delete(callback);
        };
      },
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: (callback) => {
      menu = callback;
      return () => undefined;
    },
  };
  window.a11yNotebook = bridge;
  render(<App />);
  return {
    bridge,
    vault,
    menu: (command: MenuCommand) => act(() => menu(command)),
    lock: () => act(() => locks.forEach((callback) => callback())),
  };
}
async function ready() {
  await screen.findByRole('heading', { name: 'Planning' });
}
async function openMilestones() {
  fireEvent.click(screen.getByRole('button', { name: 'Open Milestones' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const record: Milestone = {
  id: 'backend-milestone-id',
  title: 'Old vault response',
  status: 'planned',
  dueDate: '2026-10-10',
  notePaths: [],
  tasks: [],
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
  progress: { total: 0, completed: 0, missing: 0, percentage: 0, summary: '0 of 0 tasks complete' },
};

describe('milestone shell wiring', () => {
  it('opens via native command, selects/focuses the tabpanel, and closes with Ctrl+W', async () => {
    const f = setup();
    await ready();
    f.menu('show-milestones');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
    expect(screen.getByRole('tab', { name: 'Milestones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Milestones' })).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true });
    expect(screen.queryByRole('tab', { name: 'Milestones' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Welcome' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is discoverable through keyboard command search and does not leave the palette open', async () => {
    setup();
    await ready();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const search = screen.getByRole('searchbox', { name: 'Search commands' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'milestone' } });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Command palette' })).getByRole('button', { name: 'Open Milestones' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Milestones' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'w', ctrlKey: true });
    expect(screen.getByRole('tab', { name: 'Milestones' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('invalidates a pending response even when the vault picker cancels at the same path', async () => {
    const f = setup();
    await ready();
    const pending = deferred<Milestone[]>();
    vi.mocked(f.bridge.vault.getMilestones!).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Open Milestones' }));
    await waitFor(() => expect(f.bridge.vault.getMilestones).toHaveBeenCalledTimes(1));
    const picker = deferred<typeof f.vault | null>();
    vi.mocked(f.bridge.vault.open).mockReturnValueOnce(picker.promise);
    f.menu('open-vault');
    expect(screen.queryByRole('heading', { name: 'Milestones' })).not.toBeInTheDocument();
    await act(async () => picker.resolve(null));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
    await act(async () => pending.resolve([record]));
    expect(screen.queryByRole('button', { name: record.title })).not.toBeInTheDocument();
    expect(f.bridge.vault.getMilestones).toHaveBeenCalledTimes(2);
  });

  it('clears a draft on lock, suppresses pending writes, and reloads after unlock', async () => {
    const f = setup();
    await ready();
    await openMilestones();
    const pending = deferred<Milestone>();
    vi.mocked(f.bridge.vault.createMilestone!).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Private plan' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    f.lock();
    expect(screen.queryByRole('dialog', { name: 'Create milestone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Milestone title' })).not.toBeInTheDocument();
    await act(async () => pending.resolve(record));
    expect(screen.getByLabelText('Status bar')).not.toHaveTextContent('Milestone created.');
    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: record.title })).not.toBeInTheDocument();
    expect(f.bridge.vault.getMilestones).toHaveBeenCalledTimes(2);
  });

  it('opens an associated note and moves keyboard focus to its main content', async () => {
    const f = setup(true);
    vi.mocked(f.bridge.vault.getMilestones!).mockResolvedValue([
      { ...record, title: 'Release', notePaths: ['Plan.md'] },
    ]);
    await ready();
    await openMilestones();
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    const note = screen.getByRole('button', { name: 'Plan.md' });
    note.focus();
    fireEvent.click(note);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tabpanel', { name: 'Plan' })).toHaveFocus();
    expect(f.bridge.vault.readNote).toHaveBeenCalledWith('Plan.md', undefined);
  });

  it('announces a successful save only through App status, keeping notice and progress non-live', async () => {
    const f = setup();
    vi.mocked(f.bridge.vault.getMilestones!).mockResolvedValue([record]);
    vi.mocked(f.bridge.vault.createMilestone!).mockResolvedValue(record);
    await ready();
    await openMilestones();
    fireEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: record.title } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: record.dueDate } });
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const appStatus = within(screen.getByLabelText('Status bar')).getByRole('status');
    expect(appStatus).toHaveTextContent('Milestone created.');
    expect(
      screen.getAllByRole('status').filter((element) => element.textContent?.includes('Milestone created.')),
    ).toEqual([appStatus]);
    const milestoneView = screen.getByRole('region', { name: 'Milestones' });
    expect(within(milestoneView).getByText('Milestone created.').closest('[role="status"], [aria-live]')).toBeNull();
    const progress = within(milestoneView).getByText('0 of 0 tasks complete (0%); 0 unavailable tasks.');
    expect(progress.closest('[role="status"], [aria-live]')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)(
    'does not reopen an associated note or password dialog from a stale read %s after lock',
    async (result) => {
      const f = setup(true);
      vi.mocked(f.bridge.vault.getMilestones!).mockResolvedValue([
        { ...record, title: 'Release', notePaths: ['Plan.md'] },
      ]);
      await ready();
      await openMilestones();
      fireEvent.click(screen.getByRole('button', { name: 'Release' }));
      let finish!: (value: string) => void;
      let fail!: (reason: Error) => void;
      vi.mocked(f.bridge.vault.readNote).mockReturnValueOnce(
        new Promise<string>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Plan.md' }));
      f.lock();
      await act(async () =>
        result === 'resolve' ? finish('# Private note') : fail(new Error('Enter the note’s password')),
      );
      expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: /note password/i })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'password' } });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
      expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );
});
