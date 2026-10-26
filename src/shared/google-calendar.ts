import type { AppointmentInput, CalendarAppointment, CalendarRecurrence } from './calendar';

/**
 * Pure mapping between local calendar appointments and Google Calendar API
 * event bodies. No network, no auth, no Electron APIs: the sync engine owns
 * transport and credentials, and this module is testable on its own.
 *
 * Known model mismatches, stated so a later reader does not mistake them
 * for bugs:
 * - The app's recurrence model has no per-occurrence exceptions, so Google
 *   EXDATE/RDATE lines are dropped on import. The series still syncs, but a
 *   single occurrence edited or deleted in Google will not be reflected.
 * - Monthly series on day 29–31: the app clamps short months (Jan 31 -> Feb
 *   28 -> Mar 31) while Google's RRULE skips them (no February occurrence).
 *   The RRULE carries no BYMONTHDAY, so Google uses the start day.
 * - Local appointment links are not a Google concept and are never sent.
 *   The sync engine must preserve them when applying remote changes.
 * - UNTIL is inclusive on both sides (the app's until date may hold an
 *   occurrence; RFC 5545 UNTIL is inclusive), so date-form UNTIL maps
 *   directly. Datetime UNTIL is converted through the calendar's time zone
 *   when the engine provides one; without it, the series start offset is
 *   used, which can shift the final occurrence across a daylight-saving
 *   transition. The engine should always provide the time zone.
 */

export interface GoogleCalendarEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventDateTime;
  end?: GoogleCalendarEventDateTime;
  recurrence?: string[];
  status?: string;
  updated?: string;
}

export interface GoogleMappingOptions {
  /** IANA time zone of the Google calendar, for UNTIL conversion. */
  timeZone?: string;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQUENCY_TO_RRULE: Record<CalendarRecurrence['frequency'], string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};
const RRULE_TO_FREQUENCY: Record<string, CalendarRecurrence['frequency']> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function addDaysToDateOnly(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatBasicUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Offset of an IANA zone at a UTC instant, in minutes. Positive = ahead. */
function zoneOffsetMinutes(timeZone: string, utcDate: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcDate);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.get('year')),
    Number(lookup.get('month')) - 1,
    Number(lookup.get('day')),
    Number(lookup.get('hour')),
    Number(lookup.get('minute')),
    Number(lookup.get('second')),
  );
  return Math.round((asUtc - utcDate.getTime()) / 60000);
}

/** Convert a wall-clock date + time in an IANA zone to a basic UTC string. */
function zonedTimeToUtc(date: string, time: string, timeZone: string): string {
  const asUtc = Date.parse(`${date}T${time}Z`);
  let guess = asUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    guess = asUtc - zoneOffsetMinutes(timeZone, new Date(guess)) * 60000;
  }
  return formatBasicUtc(new Date(guess));
}

/** Date part of a UTC instant as seen in an IANA zone. */
function utcToZonedDate(utc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utc);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get('year')}-${lookup.get('month')}-${lookup.get('day')}`;
}

function startTimeOf(appointment: CalendarAppointment): string {
  const match = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(appointment.start);
  if (!match) return '00:00:00';
  return match[1].length === 5 ? `${match[1]}:00` : match[1];
}

function startOffsetOf(appointment: CalendarAppointment): string {
  const match = /([+-]\d{2}:?\d{2}|Z)$/.exec(appointment.start);
  if (!match || match[1] === 'Z') return 'Z';
  const offset = match[1];
  return offset.includes(':') ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
}

function untilToRrule(
  recurrence: CalendarRecurrence,
  appointment: CalendarAppointment,
  timeZone?: string,
): string | null {
  if (!recurrence.until) return null;
  if (appointment.allDay) return recurrence.until.replaceAll('-', '');
  const time = startTimeOf(appointment);
  if (timeZone) return zonedTimeToUtc(recurrence.until, time, timeZone);
  const offset = startOffsetOf(appointment);
  const utc = new Date(`${recurrence.until}T${time}${offset === 'Z' ? 'Z' : offset}`);
  return Number.isNaN(utc.getTime()) ? null : formatBasicUtc(utc);
}

function toRrule(
  recurrence: CalendarRecurrence,
  appointment: CalendarAppointment,
  timeZone?: string,
): string {
  const parts = [`FREQ=${FREQUENCY_TO_RRULE[recurrence.frequency]}`];
  if (recurrence.interval !== undefined && recurrence.interval > 1) {
    parts.push(`INTERVAL=${recurrence.interval}`);
  }
  if (recurrence.count !== undefined) parts.push(`COUNT=${recurrence.count}`);
  if (recurrence.frequency === 'weekly' && recurrence.weekdays && recurrence.weekdays.length) {
    parts.push(`BYDAY=${recurrence.weekdays.map((day) => WEEKDAY_CODES[day]).join(',')}`);
  }
  const until = untilToRrule(recurrence, appointment, timeZone);
  if (until) parts.push(`UNTIL=${until}`);
  return `RRULE:${parts.join(';')}`;
}

function parseUntil(
  value: string,
  event: GoogleCalendarEvent,
  timeZone?: string,
): string | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const instant = new Date(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.test(value)
      ? value.replace(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
          '$1-$2-$3T$4:$5:$6Z',
        )
      : value,
  );
  if (Number.isNaN(instant.getTime())) return null;
  if (timeZone) return utcToZonedDate(instant, timeZone);
  const offsetMatch = /([+-]\d{2}:?\d{2}|Z)$/.exec(event.start?.dateTime ?? '');
  if (!offsetMatch || offsetMatch[1] === 'Z') return instant.toISOString().slice(0, 10);
  const offset = offsetMatch[1];
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  const shifted = new Date(instant.getTime() + sign * (hours * 60 + minutes) * 60000);
  return shifted.toISOString().slice(0, 10);
}

function fromRrule(
  lines: string[],
  event: GoogleCalendarEvent,
  timeZone?: string,
): CalendarRecurrence | undefined {
  const line = lines.find((candidate) => candidate.startsWith('RRULE:'));
  if (!line) return undefined;
  const fields = new Map(
    line
      .slice('RRULE:'.length)
      .split(';')
      .map((field) => {
        const [key, ...rest] = field.split('=');
        return [key, rest.join('=')] as const;
      }),
  );
  const frequency = RRULE_TO_FREQUENCY[fields.get('FREQ') ?? ''];
  if (!frequency) return undefined;
  const recurrence: CalendarRecurrence = { frequency };
  const interval = Number(fields.get('INTERVAL'));
  if (Number.isInteger(interval) && interval > 1) recurrence.interval = interval;
  const count = Number(fields.get('COUNT'));
  if (Number.isInteger(count) && count >= 1) recurrence.count = count;
  if (frequency === 'weekly' && fields.get('BYDAY')) {
    const weekdays = fields
      .get('BYDAY')!
      .split(',')
      .map((code) => WEEKDAY_CODES.indexOf(code))
      .filter((day) => day >= 0);
    if (weekdays.length) recurrence.weekdays = [...new Set(weekdays)].sort((a, b) => a - b);
  }
  if (fields.get('UNTIL')) {
    const until = parseUntil(fields.get('UNTIL')!, event, timeZone);
    if (until) recurrence.until = until;
  }
  return recurrence;
}

/** Local appointment -> Google event body (no id: the engine owns it). */
export function toGoogleEvent(
  appointment: CalendarAppointment,
  options: GoogleMappingOptions = {},
): GoogleCalendarEvent {
  const event: GoogleCalendarEvent = {
    summary: appointment.title,
  };
  if (appointment.description) event.description = appointment.description;
  if (appointment.location) event.location = appointment.location;
  if (appointment.allDay) {
    event.start = { date: appointment.start };
    event.end = { date: appointment.end ?? addDaysToDateOnly(appointment.start, 1) };
  } else {
    event.start = { dateTime: appointment.start };
    event.end = { dateTime: appointment.end ?? appointment.start };
  }
  if (appointment.recurrence) {
    event.recurrence = [toRrule(appointment.recurrence, appointment, options.timeZone)];
  }
  return event;
}

/**
 * Google event -> local appointment input (no local id; the sync engine
 * assigns one). Returns 'cancelled' for remotely deleted events and null
 * for events too incomplete to link (no id, no usable start).
 */
export function fromGoogleEvent(
  event: GoogleCalendarEvent,
  options: GoogleMappingOptions = {},
): AppointmentInput | 'cancelled' | null {
  if (event.status === 'cancelled') return 'cancelled';
  if (!event.id) return null;
  const start = event.start;
  if (!start || (!start.date && !start.dateTime)) return null;
  const allDay = start.date !== undefined;
  const end = event.end;
  const appointment: AppointmentInput = {
    title: event.summary?.trim() ? event.summary : '(No title)',
    start: allDay ? start.date! : start.dateTime!,
    allDay,
    provider: 'google',
    externalId: event.id,
  };
  if (allDay) {
    appointment.end = end?.date ?? addDaysToDateOnly(start.date!, 1);
  } else if (end?.dateTime) {
    appointment.end = end.dateTime;
  }
  if (event.description) appointment.description = event.description;
  if (event.location) appointment.location = event.location;
  if (event.updated) appointment.updatedAt = event.updated;
  if (event.recurrence) {
    const recurrence = fromRrule(event.recurrence, event, options.timeZone);
    if (recurrence) appointment.recurrence = recurrence;
  }
  return appointment;
}
