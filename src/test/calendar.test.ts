import { describe, expect, it } from 'vitest';
import {
  shiftDateText,
  cleanAppointment,
  cleanAppointments,
  combineDateTime,
  dateKeyFromParts,
  expandAppointments,
  migrateCalendarAppointments,
  parseAppointmentTime,
  type CalendarAppointment,
} from '../shared/calendar';

// Build a datetime string carrying the local offset for that wall-clock time,
// so the tests assert wall-clock behavior in any timezone (CI runs on UTC).
function timed(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const probe = new Date(year, month - 1, day, hour, minute);
  const offset = -probe.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date}T${time}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function appointment(partial: Partial<CalendarAppointment> & { id: string }): CalendarAppointment {
  return {
    title: 'Test appointment',
    start: timed('2026-10-27', '09:00'),
    allDay: false,
    ...partial,
  } as CalendarAppointment;
}

const rangeStart = new Date(2026, 9, 1, 0, 0, 0);
const rangeEnd = new Date(2027, 2, 1, 0, 0, 0);

describe('calendar parsing and cleaning', () => {
  it('parses date-only and datetime strings', () => {
    expect(parseAppointmentTime('2026-10-27')).toMatchObject({ year: 2026, month: 10, day: 27 });
    expect(parseAppointmentTime(timed('2026-10-27', '09:30'))).toMatchObject({ hour: 9, minute: 30 });
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
      appointment({ id: 'bad-end', end: timed('2026-10-27', '08:00') }),
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

  it('keeps valid reminder offsets and drops invalid ones', () => {
    const cleaned = cleanAppointments([
      appointment({ id: 'ok', reminderMinutesBefore: 15 }),
      appointment({ id: 'zero', reminderMinutesBefore: 0 }),
      appointment({ id: 'negative', reminderMinutesBefore: -5 }),
      appointment({ id: 'fraction', reminderMinutesBefore: 2.5 }),
      appointment({ id: 'huge', reminderMinutesBefore: 10081 }),
      appointment({ id: 'text', reminderMinutesBefore: '15' as never }),
    ]);
    expect(cleaned.map((item) => item.id)).toEqual([
      'ok',
      'zero',
      'negative',
      'fraction',
      'huge',
      'text',
    ]);
    expect(cleaned[0].reminderMinutesBefore).toBe(15);
    expect(cleaned[1].reminderMinutesBefore).toBe(0);
    expect(cleaned[2].reminderMinutesBefore).toBeUndefined();
    expect(cleaned[3].reminderMinutesBefore).toBeUndefined();
    expect(cleaned[4].reminderMinutesBefore).toBeUndefined();
    expect(cleaned[5].reminderMinutesBefore).toBeUndefined();
  });
});

describe('migrateCalendarAppointments', () => {
  it('rewrites note, file, and task links when their paths move', () => {
    const appointments = [
      appointment({ id: 'a', link: { kind: 'note', path: 'Notes/Guide.md' } }),
      appointment({ id: 'b', link: { kind: 'task', path: 'Tasks.md', taskId: 'Tasks.md#stable123' } }),
      appointment({ id: 'c', link: { kind: 'task', path: 'Tasks.md', taskId: 'Tasks.md:4' } }),
      appointment({ id: 'd', link: { kind: 'file', path: 'Files/Doc.pdf' } }),
      appointment({ id: 'e' }),
    ];
    expect(migrateCalendarAppointments(appointments, 'Tasks.md', 'Work/Tasks.md')).toEqual([
      appointments[0],
      appointment({ id: 'b', link: { kind: 'task', path: 'Work/Tasks.md', taskId: 'Work/Tasks.md#stable123' } }),
      appointment({ id: 'c', link: { kind: 'task', path: 'Work/Tasks.md', taskId: 'Work/Tasks.md:4' } }),
      appointments[3],
      appointments[4],
    ]);
    expect(migrateCalendarAppointments(appointments, 'Notes', 'Archive/Notes')).toEqual([
      appointment({ id: 'a', link: { kind: 'note', path: 'Archive/Notes/Guide.md' } }),
      appointments[1],
      appointments[2],
      appointments[3],
      appointments[4],
    ]);
    expect(migrateCalendarAppointments(appointments, 'Missing.md', 'Elsewhere.md')).toBe(appointments);
  });
});

describe('calendar expansion', () => {
  it('expands a single timed appointment with its duration', () => {
    const occurrences = expandAppointments(
      [appointment({ id: 'single', start: timed('2026-10-27', '09:00'), end: timed('2026-10-27', '10:00') })],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].start).toBe(timed('2026-10-27', '09:00'));
    expect(occurrences[0].end).toBe(timed('2026-10-27', '10:00'));
  });

  it('excludes appointments outside the range', () => {
    const occurrences = expandAppointments(
      [appointment({ id: 'outside', start: timed('2027-06-01', '09:00') })],
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
          start: timed('2026-10-27', '09:00'),
          end: timed('2026-10-27', '09:30'),
          recurrence: { frequency: 'daily', count: 3 },
        }),
      ],
      rangeStart,
      rangeEnd,
    );
    expect(occurrences.map((item) => item.start)).toEqual([
      timed('2026-10-27', '09:00'),
      timed('2026-10-28', '09:00'),
      timed('2026-10-29', '09:00'),
    ]);
    expect(occurrences[2].end).toBe(timed('2026-10-29', '09:30'));
  });

  it('expands a weekly recurrence on selected weekdays', () => {
    const occurrences = expandAppointments(
      [
        appointment({
          id: 'weekly',
          // Monday 2026-10-26.
          start: timed('2026-10-26', '09:00'),
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
          start: timed('2026-10-27', '09:00'),
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
        appointment({ id: 'late', start: timed('2026-10-28', '09:00') }),
        appointment({ id: 'early', start: timed('2026-10-27', '09:00') }),
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
