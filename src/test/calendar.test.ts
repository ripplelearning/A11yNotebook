import { describe, expect, it } from 'vitest';
import {
  shiftDateText,
  cleanAppointment,
  cleanAppointments,
  combineDateTime,
  dateKeyFromParts,
  expandAppointments,
  parseAppointmentTime,
  type CalendarAppointment,
} from '../shared/calendar';

function appointment(partial: Partial<CalendarAppointment> & { id: string }): CalendarAppointment {
  return {
    title: 'Test appointment',
    start: '2026-10-27T09:00:00-07:00',
    allDay: false,
    ...partial,
  } as CalendarAppointment;
}

const rangeStart = new Date(2026, 9, 1, 0, 0, 0);
const rangeEnd = new Date(2027, 2, 1, 0, 0, 0);

describe('calendar parsing and cleaning', () => {
  it('parses date-only and datetime strings', () => {
    expect(parseAppointmentTime('2026-10-27')).toMatchObject({ year: 2026, month: 10, day: 27 });
    expect(parseAppointmentTime('2026-10-27T09:30:00-07:00')).toMatchObject({ hour: 9, minute: 30 });
    expect(parseAppointmentTime('2026-02-30')).toBeNull();
    expect(parseAppointmentTime('not a date')).toBeNull();
    expect(parseAppointmentTime('')).toBeNull();
  });

  it('drops appointments with unusable core fields', () => {
    const cleaned = cleanAppointments([
      appointment({ id: 'ok' }),
      appointment({ id: '' }),
      appointment({ id: 'no-title', title: '   ' }),
      appointment({ id: 'bad-start', start: 'yesterday' }),
      appointment({ id: 'bad-end', end: '2026-10-27T08:00:00-07:00' }),
    ]);
    expect(cleaned.map((item) => item.id)).toEqual(['ok']);
  });

  it('keeps an appointment with an invalid recurrence as a single event', () => {
    const cleaned = cleanAppointment(
      appointment({ id: 'bad-recurrence', recurrence: { frequency: 'fortnightly' } as never }),
    );
    expect(cleaned?.recurrence).toBeUndefined();
    expect(cleaned?.id).toBe('bad-recurrence');
  });

  it('validates links, including the task id requirement', () => {
    const cleaned = cleanAppointments([
      appointment({ id: 'note-link', link: { kind: 'note', path: 'Notes/Meeting.md' } }),
      appointment({ id: 'task-link', link: { kind: 'task', path: 'Notes/Work.md', taskId: 'task-1' } }),
      appointment({ id: 'task-no-id', link: { kind: 'task', path: 'Notes/Work.md' } }),
      appointment({ id: 'bad-kind', link: { kind: 'email', path: 'x' } as never }),
    ]);
    // A bad link is stripped and the appointment kept, like a bad recurrence.
    expect(cleaned.map((item) => item.id)).toEqual(['note-link', 'task-link', 'task-no-id', 'bad-kind']);
    expect(cleaned[0].link).toEqual({ kind: 'note', path: 'Notes/Meeting.md' });
    expect(cleaned[1].link).toEqual({ kind: 'task', path: 'Notes/Work.md', taskId: 'task-1' });
    expect(cleaned[2].link).toBeUndefined();
    expect(cleaned[3].link).toBeUndefined();
  });
});

describe('calendar expansion', () => {
  it('expands a single timed appointment with its duration', () => {
    const occurrences = expandAppointments(
      [appointment({ id: 'single', start: '2026-10-27T09:00:00-07:00', end: '2026-10-27T10:00:00-07:00' })],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].start).toBe('2026-10-27T09:00:00-07:00');
    expect(occurrences[0].end).toBe('2026-10-27T10:00:00-07:00');
  });

  it('excludes appointments outside the range', () => {
    const occurrences = expandAppointments(
      [appointment({ id: 'outside', start: '2027-06-01T09:00:00-07:00' })],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences).toHaveLength(0);
  });

  it('expands a daily recurrence by count', () => {
    const occurrences = expandAppointments(
      [
        appointment({
          id: 'daily',
          start: '2026-10-27T09:00:00-07:00',
          end: '2026-10-27T09:30:00-07:00',
          recurrence: { frequency: 'daily', count: 3 },
        }),
      ],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences.map((item) => item.start)).toEqual([
      '2026-10-27T09:00:00-07:00',
      '2026-10-28T09:00:00-07:00',
      '2026-10-29T09:00:00-07:00',
    ]);
    expect(occurrences[2].end).toBe('2026-10-29T09:30:00-07:00');
  });

  it('expands a weekly recurrence on selected weekdays', () => {
    const occurrences = expandAppointments(
      [
        appointment({
          id: 'weekly',
          // Monday 2026-10-26.
          start: '2026-10-26T09:00:00-07:00',
          recurrence: { frequency: 'weekly', weekdays: [1, 3], until: '2026-11-06' },
        }),
      ],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences.map((item) => item.start.slice(0, 10))).toEqual([
      '2026-10-26',
      '2026-10-28',
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('keeps the original day for monthly recurrences across short months', () => {
    const occurrences = expandAppointments(
      [
        appointment({
          id: 'monthly',
          start: '2026-01-31T09:00:00-08:00',
          recurrence: { frequency: 'monthly', count: 3 },
        }),
      ],
      new Date(2026, 0, 1),
      new Date(2026, 4, 1),
    );
    expect(occurrences.map((item) => item.start.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('clamps February 29th on non-leap years and restores it on leap years', () => {
    const occurrences = expandAppointments(
      [
        appointment({
          id: 'yearly',
          start: '2024-02-29T09:00:00-08:00',
          recurrence: { frequency: 'yearly', count: 3 },
        }),
      ],
      new Date(2024, 0, 1),
      new Date(2027, 0, 1),
    );
    expect(occurrences.map((item) => item.start.slice(0, 10))).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
    ]);
  });

  it('stops a recurrence at its until date', () => {
    const occurrences = expandAppointments(
      [
        appointment({
          id: 'until',
          start: '2026-10-27T09:00:00-07:00',
          recurrence: { frequency: 'daily', until: '2026-10-29' },
        }),
      ],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences).toHaveLength(3);
  });

  it('expands all-day events as dates, one occurrence per spanned day', () => {
    const occurrences = expandAppointments(
      [
        appointment({ id: 'day', start: '2026-10-27', allDay: true }),
        appointment({ id: 'span', start: '2026-10-28', end: '2026-10-31', allDay: true }),
      ],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences.map((item) => `${item.appointmentId}:${item.start}`)).toEqual([
      'day:2026-10-27',
      'span:2026-10-28',
      'span:2026-10-29',
      'span:2026-10-30',
    ]);
    expect(occurrences.every((item) => item.allDay)).toBe(true);
  });

  it('sorts occurrences by start across appointments', () => {
    const occurrences = expandAppointments(
      [
        appointment({ id: 'late', start: '2026-10-28T09:00:00-07:00' }),
        appointment({ id: 'early', start: '2026-10-27T09:00:00-07:00' }),
      ],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences.map((item) => item.appointmentId)).toEqual(['early', 'late']);
  });
});

describe('dialog date helpers', () => {
  it('combines a date and time into a local ISO datetime', () => {
    const combined = combineDateTime('2026-10-27', '14:30');
    expect(combined).toMatch(/^2026-10-27T14:30:00[+-]\d{2}:\d{2}$/);
    expect(parseAppointmentTime(combined)).not.toBeNull();
  });

  it('rejects bad dates and times when combining', () => {
    expect(combineDateTime('2026-02-30', '14:30')).toBeNull();
    expect(combineDateTime('2026-10-27', '24:00')).toBeNull();
    expect(combineDateTime('2026-10-27', '2:30')).toBeNull();
  });

  it('shifts dates across month boundaries', () => {
    expect(shiftDateText('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDateText('2026-10-28', -1)).toBe('2026-10-27');
    expect(shiftDateText('2026-02-30', 1)).toBeNull();
  });

  it('formats a date key from parsed parts', () => {
    expect(dateKeyFromParts(parseAppointmentTime('2026-10-27')!)).toBe('2026-10-27');
  });
});
