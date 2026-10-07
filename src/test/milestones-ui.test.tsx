import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MilestoneDialog from '../renderer/features/milestones/MilestoneDialog';
import MilestonesView from '../renderer/features/milestones/MilestonesView';
import type { NotebookBridge } from '../shared/bridge';
import type { Milestone, NewMilestone } from '../shared/milestones';
import type { VaultChangedEvent } from '../shared/search';
import type { VaultTask } from '../shared/types';

afterEach(() => {
  delete window.a11yNotebook;
});

const markdown: VaultTask = { id: 'Plan.md:2', path: 'Plan.md', line: 2, text: 'Draft', complete: false };
const html: VaultTask = {
  id: 'Plan.html#html-task-1234',
  taskId: 'html-task-1234',
  path: 'Plan.html',
  text: 'Review',
  complete: true,
  htmlTask: true,
};
function milestone(change: Partial<Milestone> = {}): Milestone {
  return {
    id: 'stable-milestone-id',
    title: 'Release',
    dueDate: '2026-10-10',
    status: 'active',
    notePaths: ['Plan.md'],
    tasks: [{ path: html.path, taskId: html.taskId! }],
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    progress: { total: 1, completed: 1, missing: 0, percentage: 100, summary: '1 of 1 tasks complete' },
    ...change,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(initial = [milestone()]) {
  let items = initial;
  let changed: (event: VaultChangedEvent) => void = () => undefined;
  let locked: () => void = () => undefined;
  const unsubscribe = vi.fn();
  const api = {
    getMilestones: vi.fn(async () => items),
    getTasks: vi.fn(async () => [markdown, html]),
    createMilestone: vi.fn(async (input: NewMilestone) => {
      const saved = milestone({
        ...input,
        notePaths: input.notePaths ?? [],
        tasks: input.tasks ?? [],
        id: 'created-backend-id',
      });
      items = [...items, saved];
      return saved;
    }),
    updateMilestone: vi.fn(async (id: string, input: NewMilestone) => {
      const saved = milestone({ ...input, notePaths: input.notePaths ?? [], tasks: input.tasks ?? [], id });
      items = items.map((item) => (item.id === id ? saved : item));
      return saved;
    }),
    deleteMilestone: vi.fn(async (id: string) => {
      items = items.filter((item) => item.id !== id);
    }),
    onChanged: (callback: typeof changed) => {
      changed = callback;
      return unsubscribe;
    },
    onSecurityLocked: (callback: typeof locked) => {
      locked = callback;
      return unsubscribe;
    },
  };
  window.a11yNotebook = { vault: api } as unknown as NotebookBridge;
  const announce = vi.fn();
  const onOpenNote = vi.fn(async () => undefined);
  let active = true;
  const props = {
    vaultPath: '/vault',
    notePaths: ['Plan.md', 'Plan.html'],
    isCurrent: () => active,
    announce,
    onOpenNote,
  };
  return {
    api,
    props,
    announce,
    onOpenNote,
    unsubscribe,
    changed: (vaultPath = '/vault') => changed({ vaultPath, paths: ['Plan.md'] }),
    lock: () => locked(),
    invalidate: () => {
      active = false;
    },
    replace: (value: Milestone[]) => {
      items = value;
    },
  };
}
async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create milestone' })).toBeEnabled());
}
async function detail() {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Release' }));
  return screen.getByRole('heading', { name: 'Release' });
}

describe('milestone planning UI', () => {
  it('lists due dates, statuses, progress, filters and accessible focused details', async () => {
    const f = setup([
      milestone(),
      milestone({ id: 'later', title: 'Later', status: 'planned', dueDate: '2026-11-01' }),
    ]);
    render(<MilestonesView {...f.props} />);
    expect(await detail()).toHaveFocus();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
      'Release2026-10-10active1 of 1 tasks complete (100%)',
    );
    expect(screen.getByRole('progressbar', { name: 'Task progress for Release' })).toHaveAttribute('value', '1');
    fireEvent.change(screen.getByLabelText('Filter milestone status'), { target: { value: 'planned' } });
    expect(within(table).queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });

  it('creates with note/task associations using backend IDs, never line numbers as stable IDs', async () => {
    const f = setup([]);
    render(<MilestonesView {...f.props} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    const dialog = screen.getByRole('dialog', { name: 'Create milestone' });
    expect(screen.getByLabelText('Milestone title')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: ' Launch ' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Milestone status'), { target: { value: 'active' } });
    fireEvent.click(within(dialog).getByLabelText('Plan.md'));
    fireEvent.click(within(dialog).getByLabelText('Draft — Plan.md'));
    fireEvent.click(within(dialog).getByLabelText('Review — Plan.html (complete)'));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() =>
      expect(f.api.createMilestone).toHaveBeenCalledWith({
        title: 'Launch',
        dueDate: '2026-12-01',
        status: 'active',
        notePaths: ['Plan.md'],
        tasks: [
          { path: 'Plan.md', taskId: markdown.id },
          { path: 'Plan.html', taskId: html.taskId },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(f.announce).toHaveBeenCalledWith('Milestone created.');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Launch' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() => expect(f.api.updateMilestone).toHaveBeenCalledWith('created-backend-id', expect.anything()));
  });

  it('edits status and dates without changing existing stable or missing associations', async () => {
    const f = setup([
      milestone({ notePaths: ['Missing.md'], tasks: [{ path: 'Missing.md', taskId: 'missing-task-1234' }] }),
    ]);
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    expect(screen.getByLabelText('Missing.md (unavailable)')).toBeChecked();
    expect(screen.getByLabelText('Unavailable task — Missing.md — missing-task-1234')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Milestone status'), { target: { value: 'completed' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() =>
      expect(f.api.updateMilestone).toHaveBeenCalledWith('stable-milestone-id', {
        title: 'Release',
        dueDate: '2026-10-20',
        status: 'completed',
        notePaths: ['Missing.md'],
        tasks: [{ path: 'Missing.md', taskId: 'missing-task-1234' }],
      }),
    );
  });

  it('uses backend-normalized Markdown identities on subsequent edits instead of the original line identity', async () => {
    const f = setup([]);
    const anchored = { ...markdown, id: 'Plan.md#backend-task-1234', taskId: 'backend-task-1234' };
    f.api.createMilestone.mockImplementationOnce(async (input) => {
      const saved = milestone({
        ...input,
        id: 'created-backend-id',
        tasks: [{ path: markdown.path, taskId: anchored.taskId }],
      });
      f.replace([saved]);
      f.api.getTasks.mockResolvedValue([anchored, html]);
      return saved;
    });
    render(<MilestonesView {...f.props} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Anchored plan' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByLabelText('Draft — Plan.md'));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit milestone' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    expect(screen.getByLabelText('Draft — Plan.md')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() =>
      expect(f.api.updateMilestone).toHaveBeenCalledWith(
        'created-backend-id',
        expect.objectContaining({ tasks: [{ path: 'Plan.md', taskId: 'backend-task-1234' }] }),
      ),
    );
  });

  it('does not offer tasks with ambiguous backend identities for new associations', () => {
    render(
      <MilestoneDialog
        notePaths={[]}
        tasks={[html, { ...html, text: 'Duplicate' }]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Tasks with ambiguous identities cannot be added.');
  });

  it('supports removing associations without touching source tasks', async () => {
    const f = setup();
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    fireEvent.click(screen.getByLabelText('Plan.md'));
    fireEvent.click(screen.getByLabelText('Review — Plan.html (complete)'));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() =>
      expect(f.api.updateMilestone).toHaveBeenCalledWith(
        'stable-milestone-id',
        expect.objectContaining({ notePaths: [], tasks: [] }),
      ),
    );
  });

  it('traps Tab and Shift+Tab, cancels with Escape and restores the invoker without writing', async () => {
    const f = setup();
    render(<MilestonesView {...f.props} />);
    await ready();
    const invoker = screen.getByRole('button', { name: 'Create milestone' });
    invoker.focus();
    fireEvent.click(invoker);
    const title = screen.getByLabelText('Milestone title');
    fireEvent.keyDown(title, { key: 'Tab', shiftKey: true });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: 'Discard this' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invoker).toHaveFocus();
    expect(f.api.createMilestone).not.toHaveBeenCalled();
  });

  it('confirms deletion, defaults focus to Cancel and never deletes on cancellation', async () => {
    const f = setup();
    render(<MilestonesView {...f.props} />);
    await detail();
    const invoker = screen.getByRole('button', { name: 'Delete milestone' });
    invoker.focus();
    fireEvent.click(invoker);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveTextContent('Associated notes and tasks will not be deleted');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(invoker).toHaveFocus();
    expect(f.api.deleteMilestone).not.toHaveBeenCalled();
    fireEvent.click(invoker);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete milestone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(f.api.deleteMilestone).toHaveBeenCalledExactlyOnceWith('stable-milestone-id');
    expect(f.announce).toHaveBeenCalledWith('Milestone deleted.');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Milestones' })).toHaveFocus());
  });

  it('retains the form and input after validation and backend write failures', async () => {
    const f = setup([]);
    f.api.createMilestone.mockRejectedValueOnce(new Error('Disk full'));
    render(<MilestonesView {...f.props} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid due date');
    expect(f.api.createMilestone).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Retry me' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Disk full'));
    expect(screen.getByLabelText('Milestone title')).toHaveValue('Retry me');
    expect(screen.getByRole('button', { name: 'Save milestone' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(f.api.createMilestone).toHaveBeenCalledTimes(2);
  });

  it('rejects impossible calendar dates even when submitted programmatically', () => {
    const save = vi.fn(async () => undefined);
    render(
      <MilestoneDialog
        milestone={milestone({ dueDate: '2026-02-30' })}
        notePaths={[]}
        tasks={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Save milestone' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('valid due date');
    expect(save).not.toHaveBeenCalled();
  });

  it('disables duplicate submissions and prevents Escape cancellation during a write', async () => {
    const f = setup();
    const pending = deferred<Milestone>();
    f.api.updateMilestone.mockReturnValueOnce(pending.promise);
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    const form = screen.getByRole('button', { name: 'Save milestone' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(f.api.updateMilestone).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(milestone()));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refreshes live progress only for the active vault and opens associated notes/tasks', async () => {
    const f = setup();
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Plan.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review — Plan.html (complete)' }));
    expect(f.onOpenNote).toHaveBeenNthCalledWith(1, 'Plan.md', expect.any(Function));
    expect(f.onOpenNote).toHaveBeenNthCalledWith(2, 'Plan.html', expect.any(Function));
    const calls = f.api.getMilestones.mock.calls.length;
    act(() => f.changed('/other'));
    expect(f.api.getMilestones).toHaveBeenCalledTimes(calls);
    f.replace([
      milestone({ progress: { total: 1, completed: 0, missing: 1, percentage: 0, summary: '0 of 1 tasks complete' } }),
    ]);
    act(() => f.changed());
    await waitFor(() =>
      expect(screen.getByRole('table')).toHaveTextContent('0 of 1 tasks complete (0%); 1 unavailable'),
    );
    f.onOpenNote.mockRejectedValueOnce(new Error('Note unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Plan.md' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Note unavailable'));
  });

  it('keeps delete confirmation and list intact on a failed delete, allowing retry', async () => {
    const f = setup();
    f.api.deleteMilestone.mockRejectedValueOnce(new Error('Read-only vault'));
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete milestone' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Read-only vault'));
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete milestone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reports loading errors and retries through Refresh', async () => {
    const f = setup();
    f.api.getMilestones.mockRejectedValueOnce(new Error('Metadata damaged'));
    render(<MilestonesView {...f.props} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Metadata damaged'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh milestones' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not offer persistence when the milestone preload API is unavailable', async () => {
    const f = setup();
    delete window.a11yNotebook!.vault.createMilestone;
    render(<MilestonesView {...f.props} />);
    await screen.findByRole('button', { name: 'Release' });
    expect(screen.getByRole('button', { name: 'Create milestone' })).toBeDisabled();
  });

  it('ignores an older load finishing after a newer vault event', async () => {
    const f = setup();
    const first = deferred<Milestone[]>();
    f.api.getMilestones.mockReturnValueOnce(first.promise);
    render(<MilestonesView {...f.props} />);
    f.replace([milestone({ title: 'Newest' })]);
    act(() => f.changed());
    await screen.findByRole('button', { name: 'Newest' });
    await act(async () => first.resolve([milestone({ title: 'Old response' })]));
    expect(screen.queryByRole('button', { name: 'Old response' })).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)('ignores a stale load %s after unmount/vault switch', async (result) => {
    const f = setup();
    const pending = deferred<Milestone[]>();
    f.api.getMilestones.mockReturnValueOnce(pending.promise);
    const view = render(<MilestonesView {...f.props} />);
    f.invalidate();
    view.unmount();
    f.replace([milestone({ title: 'New vault' })]);
    render(<MilestonesView {...f.props} isCurrent={() => true} vaultPath="/new" />);
    await screen.findByRole('button', { name: 'New vault' });
    await act(async () =>
      result === 'resolve' ? pending.resolve([milestone()]) : pending.reject(new Error('Old failure')),
    );
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(f.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)('suppresses stale write %s and announcements on lock', async (result) => {
    const f = setup();
    const pending = deferred<Milestone>();
    f.api.updateMilestone.mockReturnValueOnce(pending.promise);
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    act(() => f.lock());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    await act(async () =>
      result === 'resolve' ? pending.resolve(milestone()) : pending.reject(new Error('Stale failure')),
    );
    expect(f.announce).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('suppresses a write resolved during the same-path vault switching generation', async () => {
    const f = setup();
    const pending = deferred<Milestone>();
    f.api.updateMilestone.mockReturnValueOnce(pending.promise);
    render(<MilestonesView {...f.props} />);
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }));
    f.invalidate();
    await act(async () => pending.resolve(milestone({ title: 'Stale title' })));
    expect(screen.queryByRole('heading', { name: 'Stale title' })).not.toBeInTheDocument();
    expect(f.announce).not.toHaveBeenCalled();
  });
});
