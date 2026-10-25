import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NewTaskDialog, { AssociatedTaskDialog } from '../renderer/features/reminders/NewTaskDialog';

describe('new task dialogs', () => {
  it('offers due date, reminder time, and priority after the task name, all optional', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const name = within(dialog).getByRole('textbox', { name: 'Task text' });
    const due = within(dialog).getByLabelText('Due date');
    const reminder = within(dialog).getByLabelText('Reminder time');
    const priority = within(dialog).getByLabelText('Priority');
    // Tab order is document order for native controls.
    expect(name.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(due.compareDocumentPosition(reminder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminder.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Plan review' } });
    fireEvent.change(due, { target: { value: '2026-11-01' } });
    fireEvent.change(reminder, { target: { value: '2026-11-01T09:00' } });
    fireEvent.change(priority, { target: { value: 'high' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith({
      text: 'Plan review',
      due: '2026-11-01',
      reminder: '2026-11-01T09:00',
      priority: 'high',
    });
  });

  it('creates a task with only a name when the optional fields are left blank', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task text' }), { target: { value: 'Just this' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith({ text: 'Just this', due: '', reminder: '', priority: 'normal' });
  });

  it('adds a reminder time between due date and priority in the associated-note dialog', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(
      <AssociatedTaskDialog
        paths={['Research/Notes.md']}
        busy={false}
        error=""
        onClose={() => undefined}
        onCreate={onCreate}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task description' }), {
      target: { value: 'Review plan' },
    });
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2026-11-02' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder time'), { target: { value: '2026-11-02T10:30' } });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith(
      'Research/Notes.md',
      'Review plan',
      '2026-11-02',
      'high',
      '2026-11-02T10:30',
    );
  });
});
