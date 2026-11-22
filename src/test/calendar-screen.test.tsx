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

function setup(
  appointments: CalendarAppointment[],
  createRequest = 0,
  openRequest: { id: string; nonce: number } | null = null,
) {
  const saveCalendar = vi.fn(async (items: CalendarAppointment[]) => items);
  const vault = {
    getCalendar: vi.fn(async () => appointments),
    saveCalendar,
    getTasks: vi.fn(async () => []),
    onChanged: () => () => undefined,
    onSecurityLocked: () => () => undefined,
  };
  window.a11yNotebook = { vault } as unknown as NotebookBridge;
  const element = (request: number) => (
    <CalendarScreen
      title="Calendar"
      vaultPath="/vault"
      notePaths={['Notes/Plan.md']}
      filePaths={[]}
      isCurrent={() => true}
      onOpenEntry={vi.fn(async () => undefined)}
      announce={vi.fn()}
      createRequest={request}
      openRequest={openRequest}
    />
  );
  const { rerender } = render(element(createRequest));
  return { saveCalendar, rerenderWithRequest: (request: number) => rerender(element(request)) };
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

  it('opens the New appointment dialog when createRequest increments', async () => {
    const { rerenderWithRequest } = setup([]);
    await screen.findByText('No appointments in this period.');
    expect(screen.queryByRole('dialog')).toBeNull();
    rerenderWithRequest(1);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('does not reopen a cancelled dialog when remounting with a stale createRequest', async () => {
    // Mounting with a request already set (the remount case after
    // Ctrl+Tab returns to calendar) must not open the dialog: only a
    // request that increments while mounted does.
    setup([], 1);
    await screen.findByText('No appointments in this period.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('saves a reminder offset chosen in the dialog', async () => {
    const { saveCalendar } = setup([]);
    await screen.findByText('No appointments in this period.');
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }));
    const dialog = await screen.findByRole('dialog');
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Dentist' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: dayKey(today) } });
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Remind me'), { target: { value: '15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    await waitFor(() => expect(saveCalendar).toHaveBeenCalled());
    const saved = saveCalendar.mock.calls[0][0] as CalendarAppointment[];
    expect(saved[0].reminderMinutesBefore).toBe(15);
  });

  it('refuses a reminder on an all-day appointment', async () => {
    setup([]);
    await screen.findByText('No appointments in this period.');
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }));
    const dialog = await screen.findByRole('dialog');
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Holiday' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: dayKey(today) } });
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Remind me'), { target: { value: '15' } });
    fireEvent.click(within(dialog).getByLabelText('All-day appointment'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Reminders are available for timed appointments only.',
    );
  });

  it('shows the reminder offset in the agenda', async () => {
    const today = new Date();
    setup([
      {
        id: 'timed-1',
        title: 'Dentist call',
        start: combineDateTime(dayKey(today), '14:30')!,
        allDay: false,
        reminderMinutesBefore: 15,
      },
    ]);
    const title = await screen.findByText('Dentist call');
    expect(title.closest('li')?.textContent).toContain('Reminder: 15 minutes before');
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

  it('deletes only the occurrence it opened from and keeps the rest of the series', async () => {
    const today = new Date();
    const secondDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    const recurring: CalendarAppointment = {
      id: 'weekly-1',
      title: 'Standup',
      start: combineDateTime(dayKey(today), '09:00')!,
      allDay: false,
      recurrence: { frequency: 'weekly', interval: 1 },
    };
    const { saveCalendar } = setup([recurring]);
    const editButtons = await screen.findAllByRole('button', { name: 'Edit Standup' });
    expect(editButtons.length).toBeGreaterThan(1);
    fireEvent.click(editButtons[1]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete appointment' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete appointment' });
    expect(within(confirm).getByText(/Delete only the occurrence on/)).toBeInTheDocument();
    expect(
      within(confirm).getByRole('button', { name: 'Delete this appointment only' }),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete this appointment only' }));
    await waitFor(() => expect(saveCalendar).toHaveBeenCalled());
    const saved = saveCalendar.mock.calls[0][0] as CalendarAppointment[];
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('weekly-1');
    expect(saved[0].recurrence).toEqual({ frequency: 'weekly', interval: 1 });
    expect(saved[0].excludedOccurrences).toEqual([combineDateTime(dayKey(secondDate), '09:00')]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findAllByRole('button', { name: 'Edit Standup' })).toHaveLength(
      editButtons.length - 1,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Deleted this occurrence.');
  });

  it('offers only the whole series when no occurrence is left to delete singly', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recurring: CalendarAppointment = {
      id: 'weekly-1',
      title: 'Standup',
      start: combineDateTime(dayKey(yesterday), '09:00')!,
      allDay: false,
      recurrence: { frequency: 'weekly', interval: 1, count: 1 },
    };
    setup([recurring], 0, { id: 'weekly-1', nonce: 1 });
    await screen.findByRole('dialog', { name: 'Edit appointment' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete appointment' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete appointment' });
    expect(
      within(confirm).getByText('Deleting removes the whole series, not just one occurrence.'),
    ).toBeInTheDocument();
    expect(
      within(confirm).queryByRole('button', { name: 'Delete this appointment only' }),
    ).not.toBeInTheDocument();
  });

  it('keeps deleted occurrences when the series is edited and saved', async () => {
    const today = new Date();
    const secondDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    const excluded = combineDateTime(dayKey(secondDate), '09:00')!;
    const recurring: CalendarAppointment = {
      id: 'weekly-1',
      title: 'Standup',
      start: combineDateTime(dayKey(today), '09:00')!,
      allDay: false,
      recurrence: { frequency: 'weekly', interval: 1 },
      excludedOccurrences: [excluded],
    };
    const { saveCalendar } = setup([recurring]);
    const editButtons = await screen.findAllByRole('button', { name: 'Edit Standup' });
    fireEvent.click(editButtons[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    await waitFor(() => expect(saveCalendar).toHaveBeenCalled());
    const saved = saveCalendar.mock.calls[0][0] as CalendarAppointment[];
    expect(saved[0].excludedOccurrences).toEqual([excluded]);
  });

  it('asks in a separate dialog that takes focus, with series wording only for recurring appointments', async () => {
    // jsdom's document is not focused by default; the alertdialog only
    // restores focus when the document has it, as in real use.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const today = new Date();
    const recurring: CalendarAppointment = {
      id: 'weekly-1',
      title: 'Standup',
      start: combineDateTime(dayKey(today), '09:00')!,
      allDay: false,
      recurrence: { frequency: 'weekly', interval: 1 },
    };
    setup([recurring]);
    const editButtons = await screen.findAllByRole('button', { name: 'Edit Standup' });
    fireEvent.click(editButtons[0]);
    await screen.findByRole('dialog', { name: 'Edit appointment' });
    // A real click focuses the button first; the confirm restores focus
    // to it when it closes.
    screen.getByRole('button', { name: 'Delete appointment' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete appointment' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete appointment' });
    expect(within(confirm).getByText(/Delete only the occurrence on/)).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Delete the whole series' })).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(confirm).getByRole('button', { name: 'Delete this appointment only' }),
    );
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep appointment' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: 'Delete appointment' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Edit appointment' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete appointment' }));
  });

  it('asks "Delete this appointment?" without series language for a single appointment', async () => {
    const today = new Date();
    const single: CalendarAppointment = {
      id: 'single-1',
      title: 'Dentist',
      start: combineDateTime(dayKey(today), '10:00')!,
      allDay: false,
    };
    const { saveCalendar } = setup([single]);
    const editButtons = await screen.findAllByRole('button', { name: 'Edit Dentist' });
    fireEvent.click(editButtons[0]);
    await screen.findByRole('dialog', { name: 'Edit appointment' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete appointment' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete appointment' });
    expect(within(confirm).getByText('Delete this appointment?')).toBeInTheDocument();
    expect(within(confirm).queryByText(/whole series/)).not.toBeInTheDocument();
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Delete appointment' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete appointment' }));
    await waitFor(() => expect(saveCalendar).toHaveBeenCalledWith([]));
  });
});
