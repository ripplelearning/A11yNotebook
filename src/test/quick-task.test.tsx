import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultShortcut,
  effectiveCommandShortcuts,
  getCommandById,
  getKeyboardShortcuts,
} from '../shared/command-registry';
import { shortcutConflicts } from '../shared/settings';
import {
  QuickTaskDialog,
  QuickTaskLibraryPicker,
  QuickTaskNotebookPicker,
} from '../renderer/features/reminders/QuickTaskDialog';

describe('quick task command defaults', () => {
  it('binds Ctrl+Q everywhere except macOS, where it is unassigned', () => {
    const command = getCommandById('quick-task');
    expect(command?.label).toBe('Quick Task');
    expect(defaultShortcut(command!)).toBe('Ctrl+Q');
    expect(defaultShortcut(command!, true)).toBeUndefined();
    expect(effectiveCommandShortcuts(command!)).toEqual(['Ctrl+Q']);
    expect(effectiveCommandShortcuts(command!, {}, {}, true)).toEqual([]);
    expect(getKeyboardShortcuts()).toContainEqual({ commandId: 'quick-task', label: 'Quick Task', shortcut: 'Ctrl+Q' });
    expect(getKeyboardShortcuts({}, {}, true).some((item) => item.commandId === 'quick-task')).toBe(false);
  });

  it('does not claim Ctrl+Q in macOS conflict checks, but does elsewhere', () => {
    expect(shortcutConflicts({}, {}, false)).toEqual([]);
    expect(shortcutConflicts({ 'quick-task': 'Ctrl+Q' }, {}, true)).toEqual([]);
    expect(shortcutConflicts({ 'show-tasks': 'Ctrl+Q' }, {}, false)).toContain('Ctrl+Q: Quick Task (quick-task) and Tasks (show-tasks)');
  });
});

describe('quick task dialog', () => {
  it('holds only a Quick Task text box, OK first and default, and Cancel', () => {
    render(<QuickTaskDialog onCreate={async () => undefined} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Quick Task' });
    const inputs = within(dialog).queryAllByRole('textbox');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAccessibleName('Quick Task');
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['OK', 'Cancel']);
    expect(buttons[0].getAttribute('type')).toBe('submit');
    expect(buttons[0]).toHaveAttribute('data-default');
  });

  it('creates the trimmed task on OK and closes', async () => {
    const onCreate = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<QuickTaskDialog onCreate={onCreate} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Quick Task' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Quick Task' }), {
      target: { value: '  Plan review  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith('Plan review'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refuses empty text instead of creating a task', () => {
    const onCreate = vi.fn(async () => undefined);
    render(<QuickTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Quick Task' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter task text.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('cancels without creating', () => {
    const onCreate = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<QuickTaskDialog onCreate={onCreate} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('quick task fallback pickers', () => {
  it('picks a library from recent libraries', () => {
    const onPick = vi.fn();
    render(
      <QuickTaskLibraryPicker
        libraries={[
          { path: '/lib/one', name: 'One' },
          { path: '/lib/two', name: 'Two' },
        ]}
        onPick={onPick}
        onOpenLibrary={vi.fn()}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Quick Task library' });
    const select = within(dialog).getByLabelText('Library');
    expect(within(select as HTMLElement).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'One',
      'Two',
    ]);
    fireEvent.change(select, { target: { value: '/lib/two' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(onPick).toHaveBeenCalledWith('/lib/two');
  });

  it('offers to open a library when there are no recent libraries', () => {
    const onOpenLibrary = vi.fn();
    render(
      <QuickTaskLibraryPicker libraries={[]} onPick={vi.fn()} onOpenLibrary={onOpenLibrary} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open library…' }));
    expect(onOpenLibrary).toHaveBeenCalled();
  });

  it('picks a notebook, or the library root', () => {
    const onPickRoot = vi.fn();
    const { unmount } = render(
      <QuickTaskNotebookPicker notebooks={['Work', 'Home/Lists']} onPick={onPickRoot} onClose={() => undefined} />,
    );
    const rootDialog = screen.getByRole('dialog', { name: 'Quick Task notebook' });
    const rootSelect = within(rootDialog).getByLabelText('Notebook');
    expect(within(rootSelect as HTMLElement).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Library root',
      'Work',
      'Home/Lists',
    ]);
    fireEvent.click(within(rootDialog).getByRole('button', { name: 'OK' }));
    expect(onPickRoot).toHaveBeenCalledWith(undefined);
    unmount();

    const onPickNotebook = vi.fn();
    render(<QuickTaskNotebookPicker notebooks={['Work', 'Home/Lists']} onPick={onPickNotebook} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Quick Task notebook' });
    fireEvent.change(within(dialog).getByLabelText('Notebook'), { target: { value: 'Home/Lists' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(onPickNotebook).toHaveBeenCalledWith('Home/Lists');
  });
});
