import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskPriorityDialog from '../renderer/features/reminders/TaskPriorityDialog';
import TaskScheduleDialog from '../renderer/features/reminders/TaskScheduleDialog';
import type { VaultTask } from '../shared/types';

const task: VaultTask = {
  id: 'Class.md#task-1',
  path: 'Class.md',
  line: 1,
  text: 'Read chapter',
  complete: false,
  dueDate: '2026-10-05',
  dueTime: '09:30',
  remindAt: '2026-10-04 08:00',
  priority: 'high',
};

describe('task schedule dialog', () => {
  it('prefills due date, time, and reminder, and saves them back', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskScheduleDialog task={task} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByLabelText('Due date, YYYY-MM-DD')).toHaveValue('2026-10-05');
    expect(screen.getByLabelText('Due time, HH:MM')).toHaveValue('09:30');
    expect(screen.getByLabelText('Reminder date, YYYY-MM-DD')).toHaveValue('2026-10-04');
    expect(screen.getByLabelText('Reminder time, HH:MM')).toHaveValue('08:00');
    fireEvent.click(screen.getByRole('button', { name: 'Save due date' }));
    expect(onSave).toHaveBeenCalledWith({ dueDate: '2026-10-05', dueTime: '09:30', remindAt: '2026-10-04 08:00' });
  });

  it('refuses a reminder date without a reminder time instead of silently dropping it', () => {
    const onSave = vi.fn();
    render(
      <TaskScheduleDialog
        task={{ ...task, dueDate: undefined, dueTime: undefined, remindAt: undefined }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Reminder date, YYYY-MM-DD'), { target: { value: '2026-10-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save due date' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Set both a reminder date and time');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a due time without a due date', () => {
    const onSave = vi.fn();
    render(
      <TaskScheduleDialog
        task={{ ...task, dueDate: undefined, dueTime: undefined, remindAt: undefined }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Due time, HH:MM'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save due date' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Set a due date to use a due time.');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('task priority dialog', () => {
  const options = ['Critical', 'High', 'Medium', 'Low', 'Optional'];

  it('rejects a multi-word priority name when adding', () => {
    render(
      <TaskPriorityDialog
        task={task}
        options={options}
        onSave={vi.fn()}
        onOptionsChange={vi.fn()}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Add a priority option'), { target: { value: 'very high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(screen.getByRole('alert')).toHaveTextContent('one word');
  });

  it('keeps at least one priority option', () => {
    render(
      <TaskPriorityDialog
        task={{ ...task, priority: 'Only' }}
        options={['Only']}
        onSave={vi.fn()}
        onOptionsChange={vi.fn()}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Keep at least one priority option.');
  });

  it('adds a valid option and saves the selected priority', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOptionsChange = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskPriorityDialog
        task={task}
        options={options}
        onSave={onSave}
        onOptionsChange={onOptionsChange}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Add a priority option'), { target: { value: 'Soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(onOptionsChange).toHaveBeenCalledWith(['critical', 'high', 'medium', 'low', 'optional', 'soon']);
    fireEvent.click(screen.getByRole('button', { name: 'Set priority' }));
    expect(onSave).toHaveBeenCalledWith('high');
  });
});
