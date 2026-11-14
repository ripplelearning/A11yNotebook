import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppointmentDialog from '../renderer/features/calendar/AppointmentDialog';
import {
  combineDateTime,
  parseAppointmentTime,
  type AppointmentInput,
  type CalendarAppointment,
} from '../shared/calendar';

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function setup(appointment?: CalendarAppointment) {
  const onSave = vi.fn(async () => undefined);
  render(
    <AppointmentDialog
      appointment={appointment}
      notePaths={[]}
      filePaths={[]}
      tasks={[]}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: appointment ? 'Edit appointment' : 'New appointment' });
  return { dialog, onSave };
}

function savedStartHour(input: AppointmentInput): number | null {
  const parts = parseAppointmentTime(input.start);
  return parts ? parts.hour : null;
}

function savedEndHour(input: AppointmentInput): number | null {
  if (!input.end) return null;
  const parts = parseAppointmentTime(input.end);
  return parts ? parts.hour : null;
}

describe('appointment dialog AM/PM comboboxes', () => {
  it('offers an accessible AM/PM combobox for the start time', () => {
    const { dialog } = setup();
    const meridiem = within(dialog).getByLabelText('Start AM or PM');
    expect(meridiem.tagName).toBe('SELECT');
    expect(meridiem).toHaveValue('AM');
    expect(within(dialog).getByRole('combobox', { name: 'Start AM or PM' })).toBe(meridiem);
  });

  it('offers an accessible AM/PM combobox for the end time once an end date is set', () => {
    const { dialog } = setup();
    expect(within(dialog).queryByLabelText('End AM or PM')).toBeNull();
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('End date (optional)'), {
      target: { value: dayKey(today) },
    });
    const meridiem = within(dialog).getByLabelText('End AM or PM');
    expect(meridiem.tagName).toBe('SELECT');
    expect(meridiem).toHaveValue('AM');
    expect(within(dialog).getByRole('combobox', { name: 'End AM or PM' })).toBe(meridiem);
  });

  it('applies the start AM/PM combobox when saving', async () => {
    const { dialog, onSave } = setup();
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Evening review' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: dayKey(today) } });
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '9:30' } });
    fireEvent.change(within(dialog).getByLabelText('Start AM or PM'), { target: { value: 'PM' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const input = onSave.mock.calls[0][0] as AppointmentInput;
    expect(savedStartHour(input)).toBe(21);
    expect(parseAppointmentTime(input.start)?.minute).toBe(30);
  });

  it('applies the end AM/PM combobox when saving', async () => {
    const { dialog, onSave } = setup();
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Workshop' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: dayKey(today) } });
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '9:00' } });
    fireEvent.change(within(dialog).getByLabelText('End date (optional)'), {
      target: { value: dayKey(today) },
    });
    fireEvent.change(within(dialog).getByLabelText('End time'), { target: { value: '2:00' } });
    fireEvent.change(within(dialog).getByLabelText('End AM or PM'), { target: { value: 'PM' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const input = onSave.mock.calls[0][0] as AppointmentInput;
    expect(savedStartHour(input)).toBe(9);
    expect(savedEndHour(input)).toBe(14);
  });

  it('saves 12 AM as hour 0 and 12 PM as hour 12 for both times', async () => {
    const { dialog, onSave } = setup();
    const today = new Date();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Midnight to noon' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: dayKey(today) } });
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '12:30' } });
    fireEvent.change(within(dialog).getByLabelText('Start AM or PM'), { target: { value: 'AM' } });
    fireEvent.change(within(dialog).getByLabelText('End date (optional)'), {
      target: { value: dayKey(today) },
    });
    fireEvent.change(within(dialog).getByLabelText('End time'), { target: { value: '12:30' } });
    fireEvent.change(within(dialog).getByLabelText('End AM or PM'), { target: { value: 'PM' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save appointment' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const input = onSave.mock.calls[0][0] as AppointmentInput;
    expect(savedStartHour(input)).toBe(0);
    expect(savedEndHour(input)).toBe(12);
  });

  it('prefills both comboboxes from a stored appointment, including the 12 AM and 12 PM edges', () => {
    const today = new Date();
    const { dialog } = setup({
      id: 'midnight-noon',
      title: 'Midnight to noon',
      start: combineDateTime(dayKey(today), '00:30')!,
      end: combineDateTime(dayKey(today), '12:30')!,
      allDay: false,
    });
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('12:30');
    expect(within(dialog).getByLabelText('Start AM or PM')).toHaveValue('AM');
    expect(within(dialog).getByLabelText('End time')).toHaveValue('12:30');
    expect(within(dialog).getByLabelText('End AM or PM')).toHaveValue('PM');
  });

  it('prefills a stored afternoon start as 12-hour time with PM', () => {
    const today = new Date();
    const { dialog } = setup({
      id: 'afternoon',
      title: 'Afternoon call',
      start: combineDateTime(dayKey(today), '14:30')!,
      allDay: false,
    });
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('02:30');
    expect(within(dialog).getByLabelText('Start AM or PM')).toHaveValue('PM');
  });
});
