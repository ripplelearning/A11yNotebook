import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreateReminderDialog from '../renderer/features/reminders/CreateReminderDialog';
import RemindersView from '../renderer/features/reminders/RemindersView';
import TaskProgressSummaries from '../renderer/features/reminders/TaskProgressSummaries';
import { groupReminders, type Reminder } from '../shared/reminders';

const now = new Date(2026, 9, 5, 10);
function reminder(id: string, when: Date, status: Reminder['status'] = 'pending'): Reminder {
  return {
    id,
    title: id,
    path: 'Study.md',
    source: 'standalone',
    scheduledAt: when.toISOString(),
    originalScheduledAt: when.toISOString(),
    status,
  };
}
const reminders = [
  reminder('Past', new Date(2026, 9, 4, 10), 'fired'),
  reminder('Today task', new Date(2026, 9, 5, 12)),
  reminder('Weekly', new Date(2026, 9, 7, 12)),
  reminder('Future', new Date(2026, 9, 20, 12)),
  reminder('Dismissed', new Date(2026, 9, 5, 12), 'dismissed'),
];

describe('accessible reminders UI', () => {
  it('groups overdue, today and this calendar week without duplicating reminders', () => {
    const groups = groupReminders(reminders, now);
    expect(groups.overdue.map((item) => item.id)).toEqual(['Past']);
    expect(groups.today.map((item) => item.id)).toEqual(['Today task']);
    expect(groups.thisWeek.map((item) => item.id)).toEqual(['Weekly']);
    render(
      <RemindersView
        reminders={reminders}
        notePaths={['Study.md']}
        onCreate={vi.fn()}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
        onOpenNote={vi.fn()}
        now={now}
      />,
    );
    expect(
      within(screen.getByRole('region', { name: 'Overdue' })).getByRole('button', { name: 'Past' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Today' })).getByRole('button', { name: 'Today task' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'This week' })).getByRole('button', { name: 'Weekly' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Reminder view' }), { target: { value: 'table' } });
    expect(screen.getByRole('table', { name: 'All active reminders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Future' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismissed' })).not.toBeInTheDocument();
  });

  it('uses native snooze controls, routes note opening and dismiss, and reports callback errors', async () => {
    const onSnooze = vi.fn();
    const onDismiss = vi.fn().mockRejectedValue(new Error('Save failed'));
    const onOpenNote = vi.fn();
    render(
      <RemindersView
        reminders={[reminders[0]]}
        notePaths={['Study.md']}
        onCreate={vi.fn()}
        onDismiss={onDismiss}
        onSnooze={onSnooze}
        onOpenNote={onOpenNote}
        now={now}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Snooze Past' }), { target: { value: '15' } });
    await waitFor(() => expect(onSnooze).toHaveBeenCalledWith('Past', 15));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Past' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('Study.md', undefined));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss Past' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Past' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  });

  it('creates standalone reminders with labelled native fields and restores modal focus', async () => {
    const onCreate = vi.fn();
    render(
      <RemindersView
        reminders={[]}
        notePaths={['Study.md']}
        onCreate={onCreate}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
        onOpenNote={vi.fn()}
        now={now}
      />,
    );
    const opener = screen.getByRole('button', { name: 'Create reminder' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create reminder' });
    expect(screen.getByRole('textbox', { name: 'Reminder title' })).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Reminder title'), { target: { value: 'Meeting' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '12:30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create reminder' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ title: 'Meeting', path: 'Study.md', scheduledAt: '2026-10-05 12:30' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('keeps the dialog open and announces validation or persistence errors', async () => {
    render(
      <CreateReminderDialog
        notePaths={['Study.md']}
        onCreate={vi.fn().mockRejectedValue(new Error('Cannot save'))}
        onClose={vi.fn()}
      />,
    );
    fireEvent.submit(screen.getByRole('textbox', { name: 'Reminder title' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('valid date and time');
    fireEvent.change(screen.getByLabelText('Reminder title'), { target: { value: 'Meeting' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '12:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create reminder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot save');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('provides notebook task counts and native progress semantics', () => {
    render(
      <TaskProgressSummaries
        tasks={[
          { id: '1', path: 'School/A.md', line: 1, text: 'Done', complete: true },
          { id: '2', path: 'School/B.md', line: 1, text: 'Later', complete: false },
          { id: '3', path: 'Home.md', line: 1, text: 'Home', complete: false },
        ]}
      />,
    );
    expect(screen.getByText('School: 1 of 2 tasks complete')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'School task progress' })).toHaveAttribute('max', '2');
    expect(screen.getByRole('progressbar', { name: 'School task progress' })).toHaveAttribute('value', '1');
    expect(screen.getByRole('progressbar', { name: 'Unfiled notes task progress' })).toBeInTheDocument();
  });
});
