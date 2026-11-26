import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NewTaskDialog, { type TaskAssociationOption } from '../renderer/features/reminders/NewTaskDialog';

const OPTIONS: TaskAssociationOption[] = [
  { kind: 'note', path: 'Research/Plan.md' },
  { kind: 'note', path: 'Research/Ideas.md' },
  { kind: 'file', path: 'Research/Report.csv' },
  { kind: 'link', path: 'Research/Example.url' },
  { kind: 'notebook', path: 'Research' },
];

function renderDialog(props: Partial<React.ComponentProps<typeof NewTaskDialog>> = {}) {
  const onCreate = vi.fn(async () => undefined);
  render(
    <NewTaskDialog options={OPTIONS} busy={false} error="" onClose={() => undefined} onCreate={onCreate} {...props} />,
  );
  return { onCreate, dialog: screen.getByRole('dialog', { name: 'New task' }) };
}

describe('unified new task dialog', () => {
  it('lists notes, files, links, and notebooks in one Associate with dropdown, grouped by type', async () => {
    const { dialog } = renderDialog();
    const select = within(dialog).getByLabelText('Associate with');
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Research/Plan.md',
      'Research/Ideas.md',
      'Research/Report.csv',
      'Research/Example.url',
      'Research',
    ]);
    expect(within(select).getByRole('group', { name: 'Notes' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'Files' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'Links' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'Notebooks' })).toBeInTheDocument();
    expect(select).toHaveValue('Research/Plan.md');
  });

  it('never lists templates as association options', async () => {
    const { dialog } = renderDialog({
      options: [
        { kind: 'note', path: 'Research/Plan.md' },
        { kind: 'note', path: 'Templates/Daily.md' },
      ],
    });
    const options = within(within(dialog).getByLabelText('Associate with')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Research/Plan.md']);
  });

  it('saves the task in the selected note with no extra link', async () => {
    const { onCreate, dialog } = renderDialog();
    fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Plan review' } });
    fireEvent.change(within(dialog).getByLabelText('Due date, MM/DD/YYYY'), { target: { value: '11/01/2026' } });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith('Research/Plan.md', 'Plan review', '2026-11-01', 'high', '', undefined);
  });

  it('saves the task in the default note and links it to a selected file', async () => {
    const { onCreate, dialog } = renderDialog({ defaultHoldingNote: 'Research/Ideas.md' });
    fireEvent.change(within(dialog).getByLabelText('Associate with'), {
      target: { value: 'Research/Report.csv' },
    });
    fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Check the report' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith('Research/Ideas.md', 'Check the report', '', 'medium', '', {
      kind: 'file',
      target: 'Research/Report.csv',
    });
    expect(
      within(dialog).getByText('Task will be saved in Research/Ideas.md and linked to Research/Report.csv.'),
    ).toBeInTheDocument();
  });

  it('links a selected saved web link as a file link and a notebook as a notebook link', async () => {
    const { onCreate, dialog } = renderDialog();
    fireEvent.change(within(dialog).getByLabelText('Associate with'), {
      target: { value: 'Research/Example.url' },
    });
    fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Visit the example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith('Research/Plan.md', 'Visit the example', '', 'medium', '', {
      kind: 'file',
      target: 'Research/Example.url',
    });

    fireEvent.change(within(dialog).getByLabelText('Associate with'), { target: { value: 'Research' } });
    fireEvent.change(within(dialog).getByLabelText('Task description'), { target: { value: 'Review the notebook' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith('Research/Plan.md', 'Review the notebook', '', 'medium', '', {
      kind: 'notebook',
      target: 'Research',
    });
  });

  it('preselects the given initial option', async () => {
    const { dialog } = renderDialog({ initialOption: { kind: 'file', path: 'Research/Report.csv' } });
    expect(within(dialog).getByLabelText('Associate with')).toHaveValue('Research/Report.csv');
  });

  it('falls back to the first note when the initial option is missing', async () => {
    const { dialog } = renderDialog({
      initialOption: { kind: 'note', path: 'Missing/Note.md' },
    });
    expect(within(dialog).getByLabelText('Associate with')).toHaveValue('Research/Plan.md');
  });

  it('keeps the task fields usable while the note list loads, with only the list and Create waiting', async () => {
    const { dialog } = renderDialog({
      loadingNotes: true,
      options: [{ kind: 'notebook', path: 'Research' }],
    });
    expect(within(dialog).getByText('Checking eligible notes…')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Task description' })).toBeEnabled();
    expect(within(dialog).getByLabelText('Associate with')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled();
  });

  it('asks for a note before adding a task when no note can hold one', async () => {
    const { dialog } = renderDialog({
      options: [{ kind: 'file', path: 'Research/Report.csv' }],
    });
    expect(within(dialog).getByText('Create an unencrypted note before adding a task.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled();
  });

  it('offers due date, reminder time, and priority after the task name, all optional', async () => {
    const { onCreate, dialog } = renderDialog();
    const name = within(dialog).getByRole('textbox', { name: 'Task description' });
    const due = within(dialog).getByLabelText('Due date, MM/DD/YYYY');
    const reminderDate = within(dialog).getByLabelText('Reminder date, MM/DD/YYYY');
    const reminderTime = within(dialog).getByLabelText('Reminder time, HH:MM');
    const priority = within(dialog).getByLabelText('Priority');
    // Tab order is document order for native controls.
    expect(name.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(due.compareDocumentPosition(reminderDate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminderDate.compareDocumentPosition(reminderTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminderTime.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Plan review' } });
    fireEvent.change(due, { target: { value: '11/01/2026' } });
    fireEvent.change(reminderDate, { target: { value: '11/01/2026' } });
    fireEvent.change(reminderTime, { target: { value: '09:00' } });
    fireEvent.change(priority, { target: { value: 'high' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith(
      'Research/Plan.md',
      'Plan review',
      '2026-11-01',
      'high',
      '2026-11-01T09:00',
      undefined,
    );
  });

  it('refuses a reminder date without a reminder time instead of silently dropping it', async () => {
    const { onCreate, dialog } = renderDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task description' }), { target: { value: 'Plan' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder date, MM/DD/YYYY'), { target: { value: '11/01/2026' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Set both a reminder date and time');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('rejects impossible dates and times typed into the text fields', async () => {
    const { onCreate, dialog } = renderDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task description' }), { target: { value: 'Plan' } });
    fireEvent.change(within(dialog).getByLabelText('Due date, MM/DD/YYYY'), { target: { value: '02/30/2026' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a due date as MM/DD/YYYY.');
    fireEvent.change(within(dialog).getByLabelText('Due date, MM/DD/YYYY'), { target: { value: '11/01/2026' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder date, MM/DD/YYYY'), { target: { value: '11/01/2026' } });
    fireEvent.change(within(dialog).getByLabelText('Reminder time, HH:MM'), { target: { value: '25:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reminder time as HH:MM or H:MM AM/PM.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a task with only a name when the optional fields are left blank', async () => {
    const { onCreate, dialog } = renderDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task description' }), {
      target: { value: 'Just this' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(onCreate).toHaveBeenCalledWith('Research/Plan.md', 'Just this', '', 'medium', '', undefined);
  });

  it('offers a Show Date Picker button for both dates', async () => {
    const { dialog } = renderDialog();
    const due = within(dialog).getByLabelText('Due date, MM/DD/YYYY');
    const reminderDate = within(dialog).getByLabelText('Reminder date, MM/DD/YYYY');
    const reminderTime = within(dialog).getByLabelText('Reminder time, HH:MM');
    const pickers = within(dialog).getAllByRole('button', { name: 'Show Date Picker' });
    expect(pickers).toHaveLength(2);
    // Each picker button follows its own date field in document order.
    expect(due.compareDocumentPosition(pickers[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((pickers[0] as Node).compareDocumentPosition(reminderDate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminderDate.compareDocumentPosition(pickers[1] as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((pickers[1] as Node).compareDocumentPosition(reminderTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(due, { target: { value: '11/01/2026' } });
    fireEvent.click(pickers[0] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: /November 15, 2026/ }));
    expect(due).toHaveValue('11/15/2026');
    fireEvent.change(reminderDate, { target: { value: '11/01/2026' } });
    fireEvent.click(pickers[1] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: /November 20, 2026/ }));
    expect(reminderDate).toHaveValue('11/20/2026');
  });
});
