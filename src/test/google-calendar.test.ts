import { describe, expect, it } from 'vitest';
import { fromGoogleEvent, toGoogleEvent, type GoogleCalendarEvent } from '../shared/google-calendar';
import type { CalendarAppointment } from '../shared/calendar';

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'local-1',
    title: 'Checkup',
    start: '2026-10-05T09:00:00-07:00',
    end: '2026-10-05T10:00:00-07:00',
    allDay: false,
    ...overrides,
  };
}

describe('google event mapping', () => {
  it('maps a timed appointment to a Google event body', () => {
    const event = toGoogleEvent(appointment({ description: 'Annual', location: 'Clinic' }));
    expect(event).toEqual({
      summary: 'Checkup',
      description: 'Annual',
      location: 'Clinic',
      start: { dateTime: '2026-10-05T09:00:00-07:00' },
      end: { dateTime: '2026-10-05T10:00:00-07:00' },
    });
    expect(event.id).toBeUndefined();
  });

  it('maps all-day appointments with exclusive ends, defaulting a missing end', () => {
    const event = toGoogleEvent(
      appointment({ allDay: true, start: '2026-10-05', end: '2026-10-07' }),
    );
    expect(event.start).toEqual({ date: '2026-10-05' });
    expect(event.end).toEqual({ date: '2026-10-07' });
    const single = toGoogleEvent(
      appointment({ allDay: true, start: '2026-10-05', end: undefined }),
    );
    expect(single.end).toEqual({ date: '2026-10-06' });
  });

  it('gives a timed appointment without an end a zero-duration Google end', () => {
    const event = toGoogleEvent(appointment({ end: undefined }));
    expect(event.end).toEqual({ dateTime: '2026-10-05T09:00:00-07:00' });
  });

  it('builds RRULE lines, omitting default interval', () => {
    const daily = toGoogleEvent(
      appointment({ recurrence: { frequency: 'daily', interval: 2, count: 5 } }),
    );
    expect(daily.recurrence).toEqual(['RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5']);
    const weekly = toGoogleEvent(
      appointment({
        recurrence: { frequency: 'weekly', weekdays: [1, 3, 5] },
      }),
    );
    expect(weekly.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
    const monthly = toGoogleEvent(appointment({ recurrence: { frequency: 'monthly' } }));
    expect(monthly.recurrence).toEqual(['RRULE:FREQ=MONTHLY']);
  });

  it('maps all-day until directly and timed until through the time zone', () => {
    const allDay = toGoogleEvent(
      appointment({
        allDay: true,
        start: '2026-10-05',
        end: '2026-10-06',
        recurrence: { frequency: 'daily', until: '2026-12-25' },
      }),
    );
    expect(allDay.recurrence).toEqual(['RRULE:FREQ=DAILY;UNTIL=20261225']);
    // Series starts in PST (-08:00); the until date is in PDT (-07:00). With
    // the calendar time zone, UNTIL is the until-date 09:00 in PDT.
    const zoned = toGoogleEvent(
      appointment({
        start: '2026-01-15T09:00:00-08:00',
        recurrence: { frequency: 'weekly', until: '2026-07-15' },
      }),
      { timeZone: 'America/Los_Angeles' },
    );
    expect(zoned.recurrence).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20260715T160000Z']);
    // Without a time zone the start offset is the documented approximation.
    const fallback = toGoogleEvent(
      appointment({
        start: '2026-01-15T09:00:00-08:00',
        recurrence: { frequency: 'weekly', until: '2026-07-15' },
      }),
    );
    expect(fallback.recurrence).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20260715T170000Z']);
  });

  it('maps a Google timed event back, keeping provider bookkeeping', () => {
    const event: GoogleCalendarEvent = {
      id: 'google-9',
      summary: 'Dentist',
      description: 'Cleaning',
      location: 'Downtown',
      start: { dateTime: '2026-10-06T14:30:00Z' },
      end: { dateTime: '2026-10-06T15:30:00Z' },
      updated: '2026-10-01T12:00:00.000Z',
    };
    expect(fromGoogleEvent(event)).toEqual({
      title: 'Dentist',
      description: 'Cleaning',
      location: 'Downtown',
      start: '2026-10-06T14:30:00Z',
      end: '2026-10-06T15:30:00Z',
      allDay: false,
      provider: 'google',
      externalId: 'google-9',
      updatedAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('maps Google all-day events with exclusive ends', () => {
    const event: GoogleCalendarEvent = {
      id: 'google-10',
      summary: 'Holiday',
      start: { date: '2026-12-25' },
      end: { date: '2026-12-26' },
    };
    const mapped = fromGoogleEvent(event);
    expect(mapped).toMatchObject({
      allDay: true,
      start: '2026-12-25',
      end: '2026-12-26',
    });
  });

  it('reports cancelled events and rejects unusable ones', () => {
    expect(fromGoogleEvent({ id: 'x', status: 'cancelled' })).toBe('cancelled');
    expect(fromGoogleEvent({ summary: 'No id' })).toBeNull();
    expect(fromGoogleEvent({ id: 'x', summary: 'No start' })).toBeNull();
  });

  it('titles an untitled Google event the way Google displays it', () => {
    const mapped = fromGoogleEvent({
      id: 'x',
      start: { dateTime: '2026-10-06T09:00:00Z' },
    });
    expect(mapped).toMatchObject({ title: '(No title)' });
  });

  it('parses RRULE back, including BYDAY and UNTIL forms', () => {
    const weekly = fromGoogleEvent({
      id: 'x',
      summary: 'Standup',
      start: { dateTime: '2026-10-05T09:00:00-07:00' },
      recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=10;BYDAY=MO,WE,FR'],
    });
    expect(weekly).toMatchObject({
      recurrence: { frequency: 'weekly', interval: 2, count: 10, weekdays: [1, 3, 5] },
    });
    const dated = fromGoogleEvent({
      id: 'x',
      summary: 'Series',
      start: { date: '2026-10-05' },
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261225'],
    });
    expect(dated).toMatchObject({ recurrence: { frequency: 'daily', until: '2026-12-25' } });
    const zoned = fromGoogleEvent(
      {
        id: 'x',
        summary: 'Series',
        start: { dateTime: '2026-01-15T09:00:00-08:00' },
        recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20260715T160000Z'],
      },
      { timeZone: 'America/Los_Angeles' },
    );
    expect(zoned).toMatchObject({ recurrence: { frequency: 'weekly', until: '2026-07-15' } });
  });

  it('keeps the event but drops an unparseable recurrence', () => {
    const mapped = fromGoogleEvent({
      id: 'x',
      summary: 'Odd',
      start: { dateTime: '2026-10-06T09:00:00Z' },
      recurrence: ['RRULE:FREQ=HOURLY', 'EXDATE:20261007T090000Z'],
    });
    expect(mapped).toMatchObject({ title: 'Odd' });
    expect(mapped).not.toHaveProperty('recurrence');
  });

  it('round-trips a recurring appointment through Google form', () => {
    const original = appointment({
      description: 'Bring notes',
      location: 'Room 3',
      recurrence: { frequency: 'weekly', weekdays: [1, 3], count: 8 },
    });
    const exported = toGoogleEvent(original);
    const imported = fromGoogleEvent({ ...exported, id: 'google-1', updated: '2026-10-01T00:00:00Z' });
    expect(imported).toMatchObject({
      title: original.title,
      start: original.start,
      end: original.end,
      allDay: false,
      description: original.description,
      location: original.location,
      recurrence: original.recurrence,
    });
  });
});
