import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import type { MenuCommand } from '../shared/ipc';
import { vaultExtensions } from './vault-extensions';

const vault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Class notes',
      path: 'Class notes',
      kind: 'notebook',
      children: [{ name: 'Week 1.md', path: 'Class notes/Week 1.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

afterEach(() => {
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

describe('task toggle undo', () => {
  it('reverses an accidental check-off through the Edit Undo command', async () => {
    let menuListener: ((command: MenuCommand) => void) | undefined;
    let complete = false;
    const task = () => ({
      id: 'Class notes/Week 1.md:4',
      path: 'Class notes/Week 1.md',
      line: 4,
      text: 'Submit',
      complete,
    });
    const toggleTask = vi.fn(async (_path: string, _location: number, next: boolean) => {
      complete = next;
      return [task()];
    });
    const bridge: NotebookBridge = {
      updater: {
        check: vi.fn(async () => undefined),
        download: vi.fn(async () => undefined),
        installNow: vi.fn(async () => undefined),
        installOnExit: vi.fn(async () => undefined),
        onStatus: vi.fn(() => () => undefined),
      },
      vault: {
        ...vaultExtensions(),
        open: vi.fn(async () => vault),
        get: vi.fn(async () => vault),
        readNote: vi.fn(async () => '# Week 1\n\nImportant material\n- [ ] Submit'),
        getTasks: vi.fn(async () => [task()]),
        toggleTask,
        setHtmlTaskDueDate: vi.fn(async () => []),
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
      },
      onMenuCommand: (callback: (command: MenuCommand) => void) => {
        menuListener = callback;
        return () => {
          menuListener = undefined;
        };
      },
    } as unknown as NotebookBridge;
    window.a11yNotebook = bridge;
    render(<App />);

    await screen.findByRole('heading', { name: 'Study' });
    act(() => menuListener?.('show-tasks'));
    const taskTable = await screen.findByRole('table', { name: 'Tasks in Study' });
    fireEvent.click(within(taskTable).getByRole('checkbox', { name: 'Submit' }));
    await waitFor(() => expect(toggleTask).toHaveBeenCalledWith('Class notes/Week 1.md', 4, true, undefined));
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Task marked complete.');

    act(() => menuListener?.('edit-undo'));
    await waitFor(() =>
      expect(toggleTask).toHaveBeenCalledWith('Class notes/Week 1.md', 4, false, undefined),
    );
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Undid the task change.');

    // The toggle is undone once: a second Undo finds nothing to reverse.
    const calls = toggleTask.mock.calls.length;
    act(() => menuListener?.('edit-undo'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toggleTask.mock.calls.length).toBe(calls);
  });

  it('reverses a check-off with Ctrl+Z pressed from the Tasks view', async () => {
    let complete = false;
    const task = () => ({
      id: 'Class notes/Week 1.md:4',
      path: 'Class notes/Week 1.md',
      line: 4,
      text: 'Submit',
      complete,
    });
    const toggleTask = vi.fn(async (_path: string, _location: number, next: boolean) => {
      complete = next;
      return [task()];
    });
    const bridge: NotebookBridge = {
      updater: {
        check: vi.fn(async () => undefined),
        download: vi.fn(async () => undefined),
        installNow: vi.fn(async () => undefined),
        installOnExit: vi.fn(async () => undefined),
        onStatus: vi.fn(() => () => undefined),
      },
      vault: {
        ...vaultExtensions(),
        open: vi.fn(async () => vault),
        get: vi.fn(async () => vault),
        readNote: vi.fn(async () => '# Week 1\n\nImportant material\n- [ ] Submit'),
        getTasks: vi.fn(async () => [task()]),
        toggleTask,
        setHtmlTaskDueDate: vi.fn(async () => []),
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
      },
      onMenuCommand: vi.fn(() => () => undefined),
    } as unknown as NotebookBridge;
    window.a11yNotebook = bridge;
    window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
    render(<App />);

    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.keyDown(document.body, { key: '4', ctrlKey: true });
    const taskTable = await screen.findByRole('table', { name: 'Tasks in Study' });
    const checkbox = within(taskTable).getByRole('checkbox', { name: 'Submit' });
    fireEvent.click(checkbox);
    await waitFor(() => expect(toggleTask).toHaveBeenCalledWith('Class notes/Week 1.md', 4, true, undefined));
    // Checking removes the task from the open list, so its row unmounts
    // and focus lands on the body; Ctrl+Z from there must undo the toggle.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() =>
      expect(toggleTask).toHaveBeenCalledWith('Class notes/Week 1.md', 4, false, undefined),
    );
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Undid the task change.');
  });
});
