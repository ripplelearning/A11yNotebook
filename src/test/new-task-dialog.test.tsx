import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NewTaskDialog, { AssociatedTaskDialog } from '../renderer/features/reminders/NewTaskDialog';

describe('new task dialogs', () => {
  it('offers due date, reminder time, and priority after the task name, all optional', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const name = within(dialog).getByRole('textbox', { name: 'Task text' });
    const due = within(dialog).getByLabelText('Due date, YYYY-MM-DD');
    const reminderDate = within(dialog).getByLabelText('Reminder date, YYYY-MM-DD');
    const reminderTime = within(dialog).getByLabelText('Reminder time, HH:MM');
    const priority = within(dialog).getByLabelText('Priority');
    // Tab order is document order for native controls.
    expect(name.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(due.compareDocumentPosition(reminderDate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminderDate.compareDocumentPosition(reminderTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminderTime.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Plan review' } });
    fireEvent.change(due, { target: { value: '2026-11-01' } });
    fireEvent.change(reminderDate, { target: { value: '2026-11-01' } });
    fireEvent.change(reminderTime, { target: { value: '09:00' } });
    fireEvent.change(priority, { target: { value: 'high' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith({
      text: 'Plan review',
      due: '2026-11-01',
      reminder: '2026-11-01T09:00',
      priority: 'high',
    });
  });

  it('refuses a reminder date without a reminder time instead of silently dropping it', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task text' }), { target: { value: 'Plan' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder date, YYYY-MM-DD'), { target: { value: '2026-11-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Set both a reminder date and time');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('rejects impossible dates and times typed into the text fields', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task text' }), { target: { value: 'Plan' } });
    fireEvent.change(within(dialog).getByLabelText('Due date, YYYY-MM-DD'), { target: { value: '2026-02-30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a due date as YYYY-MM-DD.');
    fireEvent.change(within(dialog).getByLabelText('Due date, YYYY-MM-DD'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder date, YYYY-MM-DD'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder time, HH:MM'), { target: { value: '25:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reminder time as HH:MM or H:MM AM/PM.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a task with only a name when the optional fields are left blank', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task text' }), { target: { value: 'Just this' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith({ text: 'Just this', due: '', reminder: '', priority: 'normal' });
  });

  it('offers a Show Date Picker button for both the due and reminder dates', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<NewTaskDialog onCreate={onCreate} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const due = within(dialog).getByLabelText('Due date, YYYY-MM-DD');
    const reminderDate = within(dialog).getByLabelText('Reminder date, YYYY-MM-DD');
    const reminderTime = within(dialog).getByLabelText('Reminder time, HH:MM');
    const pickers = within(dialog).getAllByRole('button', { name: 'Show Date Picker' });
    expect(pickers).toHaveLength(2);
    // Each picker button follows its own date field in document order.
    expect(due.compareDocumentPosition(pickers[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((pickers[0] as Node).compareDocumentPosition(reminderDate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminderDate.compareDocumentPosition(pickers[1] as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((pickers[1] as Node).compareDocumentPosition(reminderTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(due, { target: { value: '2026-11-01' } });
    fireEvent.click(pickers[0] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: /November 15, 2026/ }));
    expect(due).toHaveValue('2026-11-15');
    fireEvent.change(reminderDate, { target: { value: '2026-11-01' } });
    fireEvent.click(pickers[1] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: /November 20, 2026/ }));
    expect(reminderDate).toHaveValue('2026-11-20');
  });

  it('offers a Show Date Picker button for both dates in the associated-note dialog', async () => {
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
    const due = within(dialog).getByLabelText('Due date, YYYY-MM-DD');
    const reminderDate = within(dialog).getByLabelText('Reminder date, YYYY-MM-DD');
    const pickers = within(dialog).getAllByRole('button', { name: 'Show Date Picker' });
    expect(pickers).toHaveLength(2);
    fireEvent.change(due, { target: { value: '2026-11-01' } });
    fireEvent.click(pickers[0] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: /November 15, 2026/ }));
    expect(due).toHaveValue('2026-11-15');
    fireEvent.change(reminderDate, { target: { value: '2026-11-01' } });
    fireEvent.click(pickers[1] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: /November 20, 2026/ }));
    expect(reminderDate).toHaveValue('2026-11-20');
  });
});
