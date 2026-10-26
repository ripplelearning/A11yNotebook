import { describe, expect, it } from 'vitest';
import { appointmentReminders } from '../shared/appointment-reminders';
import type { CalendarAppointment } from '../shared/calendar';

const NOW = new Date(2026, 10, 1, 12, 0, 0);

function appointment(overrides: Partial<CalendarAppointment> & { id: string }): CalendarAppointment {
  return {
    title: 'Dentist',
    start: '2026-11-03T10:00:00',
    allDay: false,
    ...overrides,
  };
}

describe('appointment reminders', () => {
  it('counts back the offset from a timed start', () => {
    const [reminder] = appointmentReminders(
      [appointment({ id: 'a-1', reminderMinutesBefore: 15 })],
      NOW,
    );
    expect(reminder).toMatchObject({
      source: 'appointment',
      title: 'Dentist',
      status: 'pending',
    });
    expect(reminder.id.startsWith('appointment:a-1:2026-11-03T10:00:00')).toBe(true);
    expect(reminder.scheduledAt).toBe(new Date(2026, 10, 3, 9, 45, 0).toISOString());
    expect(reminder.originalScheduledAt).toBe(reminder.scheduledAt);
    expect(reminder.path).toBeUndefined();
  });

  it('skips appointments without a reminder and all-day appointments', () => {
    expect(
      appointmentReminders(
        [
          appointment({ id: 'a-1' }),
          appointment({ id: 'a-2', allDay: true, start: '2026-11-03', reminderMinutesBefore: 15 }),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it('includes every occurrence of a recurring series in the window', () => {
    const reminders = appointmentReminders(
      [
        appointment({
          id: 'a-1',
          start: '2026-11-02T09:00:00',
          reminderMinutesBefore: 0,
          recurrence: { frequency: 'daily', interval: 1, count: 3 },
        }),
      ],
      NOW,
    );
    expect(reminders).toHaveLength(3);
    expect(reminders.map((item) => item.scheduledAt)).toEqual([
      new Date(2026, 10, 2, 9, 0, 0).toISOString(),
      new Date(2026, 10, 3, 9, 0, 0).toISOString(),
      new Date(2026, 10, 4, 9, 0, 0).toISOString(),
    ]);
    expect(new Set(reminders.map((item) => item.id)).size).toBe(3);
  });

  it('includes the next occurrence when nothing falls in the window', () => {
    const [reminder] = appointmentReminders(
      [appointment({ id: 'a-1', start: '2027-03-10T10:00:00', reminderMinutesBefore: 60 })],
      NOW,
    );
    expect(reminder.scheduledAt).toBe(new Date(2027, 2, 10, 9, 0, 0).toISOString());
  });

  it('excludes fully past appointments but keeps one in progress', () => {
    const reminders = appointmentReminders(
      [
        appointment({ id: 'past', start: '2026-10-30T10:00:00', end: '2026-10-30T11:00:00', reminderMinutesBefore: 15 }),
        appointment({ id: 'live', start: '2026-11-01T11:00:00', end: '2026-11-01T13:00:00', reminderMinutesBefore: 15 }),
      ],
      NOW,
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].id.startsWith('appointment:live:2026-11-01T11:00:00')).toBe(true);
  });
});
