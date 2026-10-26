import { describe, expect, it } from 'vitest';
import { fromAppleEvent, toAppleIcs } from '../shared/apple-calendar';
import type { CalendarAppointment } from '../shared/calendar';

const timed: CalendarAppointment = {
  id: 'local-1',
  title: 'Dentist, check-up; bring notes',
  start: '2026-11-02T10:00:00-08:00',
  end: '2026-11-02T11:00:00-08:00',
  allDay: false,
  location: 'Clinic',
  description: 'Line one\nLine two',
  provider: 'apple',
  externalId: 'uid-1@a11ynotebook',
  updatedAt: '2026-10-25T00:00:00.000Z',
};

describe('apple calendar mapping', () => {
  it('round-trips a timed appointment', () => {
    const ics = toAppleIcs(timed, 'uid-1@a11ynotebook');
    const parsed = fromAppleEvent(ics) as { start: string; end: string } & Record<string, unknown>;
    // Times round-trip as instants: the offset string follows the machine's
    // zone, so assert instants, not the original offset spelling.
    expect(Date.parse(parsed.start)).toBe(Date.parse('2026-11-02T10:00:00-08:00'));
    expect(Date.parse(parsed.end)).toBe(Date.parse('2026-11-02T11:00:00-08:00'));
    expect(parsed).toMatchObject({
      title: 'Dentist, check-up; bring notes',
      allDay: false,
      location: 'Clinic',
      description: 'Line one\nLine two',
      provider: 'apple',
      externalId: 'uid-1@a11ynotebook',
      updatedAt: '2026-10-25T00:00:00.000Z',
    });
  });

  it('round-trips an all-day appointment with an exclusive end', () => {
    const allDay: CalendarAppointment = {
      id: 'local-2',
      title: 'Holiday',
      start: '2026-12-25',
      end: '2026-12-26',
      allDay: true,
    };
    const parsed = fromAppleEvent(toAppleIcs(allDay, 'uid-2@a11ynotebook'));
    expect(parsed).toMatchObject({ title: 'Holiday', start: '2026-12-25', end: '2026-12-26', allDay: true });
  });

  it('defaults a missing all-day end to the next day', () => {
    const parsed = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-3\r\nDTSTART;VALUE=DATE:20261225\r\nSUMMARY:Day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(parsed).toMatchObject({ start: '2026-12-25', end: '2026-12-26', allDay: true });
  });

  it('converts UTC and TZID times to the same instant locally', () => {
    const utc = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-4\r\nDTSTART:20261102T180000Z\r\nDTEND:20261102T190000Z\r\nSUMMARY:UTC\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    ) as { start: string; end: string };
    expect(Date.parse(utc.start)).toBe(Date.parse('2026-11-02T18:00:00Z'));
    expect(Date.parse(utc.end)).toBe(Date.parse('2026-11-02T19:00:00Z'));
    const zoned = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-5\r\nDTSTART;TZID=America/New_York:20261102T100000\r\nDTEND;TZID=America/New_York:20261102T110000\r\nSUMMARY:Zoned\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    ) as { start: string; end: string };
    expect(Date.parse(zoned.start)).toBe(Date.parse('2026-11-02T15:00:00Z'));
    expect(Date.parse(zoned.end)).toBe(Date.parse('2026-11-02T16:00:00Z'));
  });

  it('unfolds long lines and unescapes text', () => {
    const folded =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-6\r\nDTSTART:20261102T180000Z\r\nSUMMARY:Hello\\, world\\; with a very long title that keeps going and is folded \r\n across lines\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const parsed = fromAppleEvent(folded) as { title: string };
    expect(parsed.title).toBe('Hello, world; with a very long title that keeps going and is folded across lines');
  });

  it('maps cancelled series, missing summaries, and unrepresentable events', () => {
    const cancelled = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-7\r\nDTSTART:20261102T180000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(cancelled).toBe('cancelled');
    const untitled = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-8\r\nDTSTART:20261102T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    ) as { title: string };
    expect(untitled.title).toBe('(No title)');
    expect(
      fromAppleEvent(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:20261102T180000Z\r\nSUMMARY:No UID\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
      ),
    ).toBeNull();
  });

  it('parses weekly recurrence and skips relative patterns', () => {
    const weekly = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-9\r\nDTSTART:20261102T180000Z\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5\r\nSUMMARY:Weekly\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    ) as { recurrence: unknown };
    expect(weekly.recurrence).toEqual({
      frequency: 'weekly',
      interval: 2,
      count: 5,
      weekdays: [1, 3],
    });
    const relative = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-10\r\nDTSTART:20261110T180000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2\r\nSUMMARY:Second Tuesday\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(relative).toBeNull();
    const mismatched = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-11\r\nDTSTART:20261110T180000Z\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=15\r\nSUMMARY:Mismatch\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(mismatched).toBeNull();
  });

  it('reads date and datetime UNTIL as a local date', () => {
    const dateUntil = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-12\r\nDTSTART;VALUE=DATE:20261102\r\nRRULE:FREQ=DAILY;UNTIL=20261110\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    ) as { recurrence: { until: string } };
    expect(dateUntil.recurrence.until).toBe('2026-11-10');
    const timedUntil = fromAppleEvent(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u-13\r\nDTSTART:20261102T180000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261110T180000Z\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    ) as { recurrence: { until: string } };
    expect(timedUntil.recurrence.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('serializes recurrence rules', () => {
    const recurring: CalendarAppointment = {
      ...timed,
      recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3], count: 5 },
    };
    const ics = toAppleIcs(recurring, 'uid-14@a11ynotebook');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5;BYDAY=MO,WE');
  });
});
