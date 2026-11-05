import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrganizeLibraryDialog from '../renderer/features/vault/OrganizeLibraryDialog';
import {
  copyNode,
  deleteNode,
  relocateNode,
  setProtectedFlag,
} from '../renderer/features/vault/organize-library';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultEntry, VaultInfo } from '../shared/types';

afterEach(() => {
  delete window.a11yNotebook;
});

function fixture(): VaultEntry[] {
  return [
    {
      name: 'Work',
      path: 'Work',
      kind: 'notebook',
      children: [
        { name: 'Guide.md', path: 'Work/Guide.md', kind: 'note' },
        { name: 'Tasks.md', path: 'Work/Tasks.md', kind: 'note', protected: true },
      ],
    },
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note' }],
    },
    { name: 'Top.md', path: 'Top.md', kind: 'note' },
  ];
}

function setup() {
  let live = fixture();
  const info = (): VaultInfo => ({ name: 'Library', path: '/lib', entries: live });
  const bridge = {
    get: vi.fn(async () => info()),
    rename: vi.fn(async (from: string, name: string) => {
      const parent = from.split('/').slice(0, -1).join('/');
      live = relocateNode(live, from, [parent, name].filter(Boolean).join('/'));
      return info();
    }),
    move: vi.fn(async (from: string, to: string) => {
      live = relocateNode(live, from, to);
      return info();
    }),
    delete: vi.fn(async (path: string) => {
      live = deleteNode(live, path);
      return info();
    }),
    deletePermanently: vi.fn(async (path: string) => {
      live = deleteNode(live, path);
      return info();
    }),
    copyEntry: vi.fn(async (from: string, to: string) => {
      live = copyNode(live, from, to);
      return info();
    }),
    setProtection: vi.fn(async (path: string, value: boolean) => {
      live = setProtectedFlag(live, path, value);
      return info();
    }),
  };
  window.a11yNotebook = { vault: bridge } as unknown as NotebookBridge;
  const callbacks = {
    onClose: vi.fn(),
    onOpenEntry: vi.fn(),
    onApplied: vi.fn(),
    onPartiallyApplied: vi.fn(),
    onVaultUpdated: vi.fn(),
  };
  render(
    <OrganizeLibraryDialog
      initialEntries={fixture()}
      liveEntries={fixture()}
      tasks={[]}
      bookmarks={[]}
      reminders={[]}
      links={[]}
      hasUnsavedChanges={() => false}
      anyUnsavedChanges={() => false}
      onClose={callbacks.onClose}
      onOpenEntry={callbacks.onOpenEntry}
      onApplied={callbacks.onApplied}
      onPartiallyApplied={callbacks.onPartiallyApplied}
      onVaultUpdated={callbacks.onVaultUpdated}
    />,
  );
  return { bridge, callbacks, liveEntries: () => live };
}

async function expandWork() {
  const work = screen.getByRole('treeitem', { name: /Work/ });
  work.focus();
  fireEvent.keyDown(work, { key: 'ArrowRight' });
  await screen.findByRole('treeitem', { name: /Guide\.md/ });
}

describe('organize library dialog', () => {
  it('stages a rename and Cancel calls no bridge mutators', async () => {
    const { bridge, callbacks } = setup();
    await expandWork();
    const guide = screen.getByRole('treeitem', { name: /Guide\.md/ });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'F2' });
    const dialog = screen.getByRole('dialog', { name: 'Rename item' });
    const input = screen.getByRole('textbox', { name: 'New Name' });
    fireEvent.change(input, { target: { value: 'Guide2.md' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename item' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename item' })).not.toBeInTheDocument());
    expect(screen.getByText('1 staged change.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.rename).not.toHaveBeenCalled();
    expect(callbacks.onClose).toHaveBeenCalled();
    expect(callbacks.onApplied).not.toHaveBeenCalled();
  });

  it('announces the destination notebook when Alt+Down moves an item', async () => {
    setup();
    await expandWork();
    const guide = screen.getByRole('treeitem', { name: /Guide\.md/ });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Moved Guide.md into Archive (staged). Press OK to apply.',
    );
  });

  it('announces Library root when Alt+Shift+Up moves an item out to the top level', async () => {
    setup();
    await expandWork();
    const guide = screen.getByRole('treeitem', { name: /Guide\.md/ });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Moved Guide.md into Library root (staged). Press OK to apply.',
    );
  });

  it('applies staged changes in order when OK is pressed', async () => {
    const { bridge, callbacks } = setup();
    await expandWork();
    const guide = screen.getByRole('treeitem', { name: /Guide\.md/ });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: 'New Name' }), { target: { value: 'Guide2.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename item' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename item' })).not.toBeInTheDocument());
    const top = screen.getByRole('treeitem', { name: /Top\.md/ });
    top.focus();
    fireEvent.keyDown(top, { key: 'ArrowUp', altKey: true });
    expect(screen.getByText('2 staged changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(callbacks.onApplied).toHaveBeenCalled());
    expect(bridge.rename).toHaveBeenCalledWith('Work/Guide.md', 'Guide2.md');
    expect(bridge.move).toHaveBeenCalledWith('Top.md', 'Archive/Top.md');
    const [ops] = callbacks.onApplied.mock.calls[0] as [unknown, VaultInfo];
    expect(ops).toEqual([
      { type: 'rename', from: 'Work/Guide.md', to: 'Work/Guide2.md' },
      { type: 'move', from: 'Top.md', to: 'Archive/Top.md' },
    ]);
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it('opens the protected dialog for a staged move and carries out the move after Unprotect', async () => {
    const { bridge } = setup();
    await expandWork();
    const tasks = screen.getByRole('treeitem', { name: /Tasks\.md/ });
    tasks.focus();
    fireEvent.keyDown(tasks, { key: 'ArrowDown', altKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Protected item' });
    expect(dialog).toHaveTextContent('Tasks.md');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unprotect' }));
    await waitFor(() => expect(bridge.setProtection).toHaveBeenCalledWith('Work/Tasks.md', false));
    await waitFor(() => expect(screen.getByText('1 staged change.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bridge.move).toHaveBeenCalledWith('Work/Tasks.md', 'Archive/Tasks.md'));
  });

  it('aborts the staged change when Cancel is pressed in the protected dialog', async () => {
    const { bridge } = setup();
    await expandWork();
    const tasks = screen.getByRole('treeitem', { name: /Tasks\.md/ });
    tasks.focus();
    fireEvent.keyDown(tasks, { key: 'ArrowDown', altKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Protected item' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Protected item' })).not.toBeInTheDocument());
    expect(bridge.setProtection).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('No staged changes.');
  });

  it('pauses a commit on a protection error and resumes after Unprotect', async () => {
    const { bridge, callbacks } = setup();
    await expandWork();
    // The live copy gains protection after staging, so the first move
    // attempt fails and the dialog offers the protected dialog.
    bridge.move.mockImplementationOnce(async () => {
      throw new Error('This item is protected. Unprotect it first to rename, move, or delete it.');
    });
    bridge.get.mockImplementation(async () => ({
      name: 'Library',
      path: '/lib',
      entries: setProtectedFlag(fixture(), 'Work/Guide.md', true),
    }));
    const guide = screen.getByRole('treeitem', { name: /Guide\.md/ });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'ArrowDown', altKey: true });
    expect(screen.getByText('1 staged change.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    const dialog = await screen.findByRole('dialog', { name: 'Protected item' });
    expect(dialog).toHaveTextContent('Guide.md');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unprotect' }));
    await waitFor(() => expect(bridge.setProtection).toHaveBeenCalledWith('Work/Guide.md', false));
    await waitFor(() => expect(callbacks.onApplied).toHaveBeenCalled());
    expect(bridge.move).toHaveBeenCalledTimes(2);
    expect(bridge.move).toHaveBeenLastCalledWith('Work/Guide.md', 'Archive/Guide.md');
  });
});
