import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CalendarScreen from '../renderer/features/calendar/CalendarScreen';
import { combineDateTime, type CalendarAppointment } from '../shared/calendar';
import type { NotebookBridge } from '../shared/bridge';

afterEach(() => {
  delete window.a11yNotebook;
});

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function setup(appointments: CalendarAppointment[]) {
  const saveCalendar = vi.fn(async (items: CalendarAppointment[]) => items);
  const vault = {
    getCalendar: vi.fn(async () => appointments),
    saveCalendar,
    getTasks: vi.fn(async () => []),
    onChanged: () => () => undefined,
    onSecurityLocked: () => () => undefined,
  };
  window.a11yNotebook = { vault } as unknown as NotebookBridge;
  render(
    <CalendarScreen
      title="Calendar"
      vaultPath="/vault"
      notePaths={['Notes/Plan.md']}
      filePaths={[]}
      isCurrent={() => true}
      onOpenEntry={vi.fn(async () => undefined)}
      announce={vi.fn()}
    />,
  );
  return { saveCalendar };
}

describe('calendar screen', () => {
  it('lists today’s appointments in the agenda and shows the month grid', async () => {
    const today = new Date();
    const timed: CalendarAppointment = {
      id: 'timed-1',
      title: 'Dentist call',
      start: combineDateTime(dayKey(today), '14:30')!,
      allDay: false,
    };
    const fifteenth = new Date(today.getFullYear(), today.getMonth(), 15);
    const allDay: CalendarAppointment = {
      id: 'allday-1',
      title: 'Report due',
      start: dayKey(fifteenth),
      allDay: true,
    };
    setup([timed, allDay]);
    expect(await screen.findByText('Dentist call')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Month grid' }));
    const grid = await screen.findByRole('table');
    expect(within(grid).getAllByRole('button', { name: /\d+ appointments?/ }).length).toBeGreaterThan(0);
  });

  it('creates an appointment through the dialog and saves the list', async () => {
    const { saveCalendar } = setup([]);
    await screen.findByText('No appointments in this period.');
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter an appointment title.');
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Team sync' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: dayKey(today) } });
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    await waitFor(() => expect(saveCalendar).toHaveBeenCalled());
    const saved = saveCalendar.mock.calls[0][0] as CalendarAppointment[];
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe('Team sync');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('deletes the whole series after confirmation', async () => {
    const today = new Date();
    const recurring: CalendarAppointment = {
      id: 'weekly-1',
      title: 'Standup',
      start: combineDateTime(dayKey(today), '09:00')!,
      allDay: false,
      recurrence: { frequency: 'weekly', interval: 1 },
    };
    const { saveCalendar } = setup([recurring]);
    const editButtons = await screen.findAllByRole('button', { name: 'Edit Standup' });
    fireEvent.click(editButtons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/whole series/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete appointment' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the whole series' }));
    await waitFor(() => expect(saveCalendar).toHaveBeenCalledWith([]));
  });
});
