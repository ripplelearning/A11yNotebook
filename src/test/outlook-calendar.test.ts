import { describe, expect, it } from 'vitest';
import { fromOutlookEvent, toOutlookEvent, type OutlookEvent } from '../shared/outlook-calendar';
import type { CalendarAppointment } from '../shared/calendar';

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'local-1',
    title: 'Checkup',
    start: '2026-11-02T10:00:00-08:00',
    allDay: false,
    ...overrides,
  };
}

describe('outlook mapping', () => {
  it('sends timed appointments as UTC and all-day appointments as midnight UTC', () => {
    const timed = toOutlookEvent(appointment());
    expect(timed.subject).toBe('Checkup');
    expect(timed.start).toEqual({ dateTime: '2026-11-02T18:00:00', timeZone: 'UTC' });
    expect(timed.end).toEqual({ dateTime: '2026-11-02T18:00:00', timeZone: 'UTC' });
    const allDay = toOutlookEvent(
      appointment({ start: '2026-11-02', end: '2026-11-03', allDay: true }),
    );
    expect(allDay.start).toEqual({ dateTime: '2026-11-02T00:00:00', timeZone: 'UTC' });
    expect(allDay.end).toEqual({ dateTime: '2026-11-03T00:00:00', timeZone: 'UTC' });
  });

  it('maps recurrence patterns and ranges', () => {
    const weekly = toOutlookEvent(
      appointment({ recurrence: { frequency: 'weekly', interval: 2, weekdays: [0, 6] } }),
    );
    expect(weekly.recurrence).toEqual({
      pattern: { type: 'weekly', interval: 2, daysOfWeek: ['sunday', 'saturday'] },
      range: { type: 'noEnd', startDate: '2026-11-02' },
    });
    const monthly = toOutlookEvent(
      appointment({ recurrence: { frequency: 'monthly', interval: 1, count: 6 } }),
    );
    expect(monthly.recurrence).toEqual({
      pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 2 },
      range: { type: 'numbered', startDate: '2026-11-02', numberOfOccurrences: 6 },
    });
    const yearly = toOutlookEvent(
      appointment({ recurrence: { frequency: 'yearly', interval: 1, until: '2028-11-02' } }),
    );
    expect(yearly.recurrence).toEqual({
      pattern: { type: 'absoluteYearly', interval: 1, month: 11, dayOfMonth: 2 },
      range: { type: 'endDate', startDate: '2026-11-02', endDate: '2028-11-02' },
    });
  });

  it('reads UTC times back to the same instant and all-day dates directly', () => {
    const event: OutlookEvent = {
      id: 'o-1',
      subject: 'Checkup',
      start: { dateTime: '2026-11-02T18:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-02T19:00:00.0000000', timeZone: 'UTC' },
      lastModifiedDateTime: '2026-10-27T00:00:00Z',
    };
    const mapped = fromOutlookEvent(event)!;
    expect(Date.parse(mapped.start)).toBe(Date.parse('2026-11-02T18:00:00Z'));
    expect(Date.parse(mapped.end!)).toBe(Date.parse('2026-11-02T19:00:00Z'));
    expect(mapped).toMatchObject({ provider: 'outlook', externalId: 'o-1', allDay: false });
    const allDay = fromOutlookEvent({
      id: 'o-2',
      subject: 'Holiday',
      isAllDay: true,
      start: { dateTime: '2026-11-02T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-03T00:00:00.0000000', timeZone: 'UTC' },
    })!;
    expect(allDay).toMatchObject({ start: '2026-11-02', end: '2026-11-03', allDay: true });
  });

  it('reads weekly recurrence and flattens HTML descriptions', () => {
    const mapped = fromOutlookEvent({
      id: 'o-3',
      subject: 'Standup',
      start: { dateTime: '2026-11-02T18:00:00.0000000', timeZone: 'UTC' },
      body: { contentType: 'html', content: '<p>Hello <b>World</b></p>' },
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
        range: { type: 'numbered', startDate: '2026-11-02', numberOfOccurrences: 4 },
      },
    })!;
    expect(mapped.description).toBe('Hello World');
    expect(mapped.recurrence).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 3],
      count: 4,
    });
  });

  it('skips instances, relative patterns, and unusable events', () => {
    expect(fromOutlookEvent({ id: 'o-4', seriesMasterId: 'o-master' })).toBeNull();
    expect(
      fromOutlookEvent({
        id: 'o-5',
        start: { dateTime: '2026-11-02T18:00:00.0000000', timeZone: 'UTC' },
        recurrence: {
          pattern: { type: 'relativeMonthly', interval: 1 },
          range: { type: 'noEnd', startDate: '2026-11-02' },
        },
      }),
    ).toBeNull();
    expect(fromOutlookEvent({ subject: 'No id' })).toBeNull();
    expect(fromOutlookEvent({ id: 'o-6' })).toBeNull();
  });
});
