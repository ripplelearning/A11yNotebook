import type { AppointmentInput, CalendarAppointment, CalendarRecurrence } from './calendar';

/**
 * Pure mapping between local calendar appointments and iCalendar VEVENTs
 * for Apple CalDAV. No network, no auth, no Electron APIs: the sync
 * engine owns transport and credentials, and this module is testable on
 * its own.
 *
 * Time zones: timed values are pushed as UTC (basic `Z` form) and pulled
 * back to local wall-clock time with the local offset, so a push/pull
 * round trip reproduces the stored string exactly and does not
 * manufacture a spurious conflict. All-day events are date-only on both
 * sides and are never converted. A TZID on pull is converted through
 * Intl to the local zone; a floating (zone-less) time is read as local.
 *
 * Known model mismatches, stated so a later reader does not mistake them
 * for bugs:
 * - Relative recurrence ("second Tuesday", yearly BYDAY) has no app
 *   equivalent, so such events are skipped on pull rather than shown
 *   with wrong dates. A skipped event is never deleted locally, but the
 *   app cannot display or edit it.
 * - Monthly/yearly patterns without BYMONTHDAY/BYMONTH default to the
 *   DTSTART day and month, which is also what the app does, so those
 *   round-trip. A BYMONTHDAY or BYMONTH that disagrees with DTSTART is
 *   skipped: the app has no field to hold it.
 * - Per-occurrence exceptions (EXDATE/RDATE) are dropped on import. The
 *   series still syncs, but a single occurrence edited or deleted in
 *   Apple Calendar will not be reflected.
 * - Monthly series on day 29-31: the app clamps short months (Jan 31 ->
 *   Feb 28 -> Mar 31) while a plain RRULE skips them (no February
 *   occurrence).
 * - Local appointment links are not an iCalendar concept and are never
 *   sent. applySync preserves the local link when remote content wins.
 * - UNTIL is inclusive on both sides, so a date-form UNTIL maps directly
 *   to the app's until date. A datetime UNTIL is read as its local date.
 */

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const CODE_TO_WEEKDAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};
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

function localOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** Local wall-clock form with offset, the app's stored shape for timed starts. */
function formatLocalDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    localOffset(date)
  );
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

/** A wall-clock date + time in an IANA zone, as a UTC instant. */
function zonedWallClockToUtc(date: string, time: string, timeZone: string): Date {
  const asUtc = Date.parse(`${date}T${time}Z`);
  let guess = asUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    guess = asUtc - zoneOffsetMinutes(timeZone, new Date(guess)) * 60000;
  }
  return new Date(guess);
}

function addDaysToDateOnly(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\;/g, ';')
    .replace(/\\,/g, ',')
    .replace(/\\\\/g, '\\');
}

/** Fold a content line at 75 octets without splitting a UTF-8 sequence. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let start = 0;
  let first = true;
  while (start < line.length) {
    const limit = first ? 75 : 74;
    let end = start;
    let used = 0;
    while (end < line.length) {
      const size = encoder.encode(line[end]).length;
      if (used + size > limit) break;
      used += size;
      end += 1;
    }
    if (end === start) end = start + 1;
    chunks.push(line.slice(start, end));
    start = end;
    first = false;
  }
  return chunks.join('\r\n ');
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseVevent(ics: string): IcsProperty[] | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'BEGIN:VEVENT');
  const end = lines.findIndex((line) => line.trim() === 'END:VEVENT');
  if (start < 0 || end < 0 || end <= start) return null;
  const properties: IcsProperty[] = [];
  for (const line of lines.slice(start + 1, end)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const segments = head.split(';');
    const name = segments[0].toUpperCase();
    const params: Record<string, string> = {};
    for (const segment of segments.slice(1)) {
      const equals = segment.indexOf('=');
      if (equals > 0) params[segment.slice(0, equals).toUpperCase()] = segment.slice(equals + 1);
    }
    properties.push({ name, params, value: line.slice(colon + 1) });
  }
  return properties;
}

function findProperty(properties: IcsProperty[], name: string): IcsProperty | undefined {
  return properties.find((property) => property.name === name);
}

/**
 * Parse a basic iCalendar date or datetime into the app's stored shape:
 * a date for all-day values, or local wall-clock time with the local
 * offset for timed values. The returned date is the LOCAL date, which
 * can differ from the UTC date across midnight.
 */
function parseDateTimeValue(property: IcsProperty): { stored: string; date: string } | null {
  const value = property.value.trim();
  if (property.params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    return { stored: date, date };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const time = `${match[4]}:${match[5]}:${match[6]}`;
  let instant: Date;
  if (match[7] === 'Z') {
    instant = new Date(`${date}T${time}Z`);
  } else if (property.params.TZID) {
    try {
      instant = zonedWallClockToUtc(date, time, property.params.TZID);
    } catch {
      instant = new Date(`${date}T${time}`);
    }
  } else {
    instant = new Date(`${date}T${time}`);
  }
  const stored = formatLocalDateTime(instant);
  return { stored, date: stored.slice(0, 10) };
}

function parseRrule(value: string, startDate: string): CalendarRecurrence | null {
  const fields = new Map<string, string>();
  for (const part of value.split(';')) {
    const equals = part.indexOf('=');
    if (equals > 0) fields.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1));
  }
  const frequency = RRULE_TO_FREQUENCY[fields.get('FREQ') ?? ''];
  if (!frequency) return null;
  // Relative patterns have no app equivalent.
  if (fields.has('BYSETPOS')) return null;
  const recurrence: CalendarRecurrence = { frequency };
  const interval = Number(fields.get('INTERVAL') ?? '1');
  if (Number.isFinite(interval) && interval > 1) recurrence.interval = interval;
  const count = Number(fields.get('COUNT') ?? '');
  if (Number.isFinite(count) && count > 0) recurrence.count = count;
  const until = fields.get('UNTIL');
  if (until) {
    if (/^\d{8}$/.test(until)) {
      recurrence.until = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    } else {
      const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(until);
      if (!match) return null;
      const utc = new Date(
        `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
      );
      recurrence.until = formatLocalDateTime(utc).slice(0, 10);
    }
  }
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const startWeekday = new Date(Date.UTC(startYear, startMonth - 1, startDay)).getUTCDay();
  if (frequency === 'weekly') {
    const byday = fields.get('BYDAY');
    if (byday) {
      const weekdays = byday
        .split(',')
        .map((code) => CODE_TO_WEEKDAY[code.trim()])
        .filter((day) => day !== undefined);
      if (weekdays.length === 0) return null;
      recurrence.weekdays = weekdays;
    } else {
      recurrence.weekdays = [startWeekday];
    }
  }
  if (frequency === 'monthly') {
    // A BYDAY monthly pattern is relative ("every Tuesday"); only a
    // BYMONTHDAY matching the start day is representable.
    if (fields.has('BYDAY')) return null;
    const bymonthday = fields.get('BYMONTHDAY');
    if (bymonthday && Number(bymonthday.split(',')[0]) !== startDay) return null;
  }
  if (frequency === 'yearly') {
    if (fields.has('BYDAY')) return null;
    const bymonth = fields.get('BYMONTH');
    if (bymonth && Number(bymonth.split(',')[0]) !== startMonth) return null;
    const bymonthday = fields.get('BYMONTHDAY');
    if (bymonthday && Number(bymonthday.split(',')[0]) !== startDay) return null;
  }
  return recurrence;
}

/**
 * Parse one VEVENT into a local appointment input. Returns 'cancelled'
 * for a cancelled series (the transport turns that into a deletion),
 * null for anything that cannot be represented (missing UID/DTSTART,
 * unknown or relative recurrence, non-event component).
 */
export function fromAppleEvent(ics: string): AppointmentInput | 'cancelled' | null {
  const properties = parseVevent(ics);
  if (!properties) return null;
  const uid = findProperty(properties, 'UID')?.value.trim();
  const startProperty = findProperty(properties, 'DTSTART');
  if (!uid || !startProperty) return null;
  if (findProperty(properties, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED') {
    return 'cancelled';
  }
  const allDay =
    startProperty.params.VALUE === 'DATE' || /^\d{8}$/.test(startProperty.value.trim());
  const startParsed = parseDateTimeValue(startProperty);
  if (!startParsed) return null;
  const start = startParsed.stored;
  const appointment: AppointmentInput = {
    title: findProperty(properties, 'SUMMARY')
      ? unescapeText(findProperty(properties, 'SUMMARY')!.value)
      : '(No title)',
    start,
    allDay,
    provider: 'apple',
    externalId: uid,
  };
  const location = findProperty(properties, 'LOCATION');
  if (location && location.value) appointment.location = unescapeText(location.value);
  const description = findProperty(properties, 'DESCRIPTION');
  if (description && description.value) appointment.description = unescapeText(description.value);
  const endProperty = findProperty(properties, 'DTEND');
  if (endProperty) {
    const endParsed = parseDateTimeValue(endProperty);
    if (endParsed) appointment.end = endParsed.stored;
  } else if (allDay) {
    appointment.end = addDaysToDateOnly(start, 1);
  }
  const rrule = findProperty(properties, 'RRULE');
  if (rrule) {
    const recurrence = parseRrule(rrule.value, start.slice(0, 10));
    if (!recurrence) return null;
    appointment.recurrence = recurrence;
  }
  const modified = findProperty(properties, 'LAST-MODIFIED') ?? findProperty(properties, 'DTSTAMP');
  if (modified) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(modified.value.trim());
    if (match) {
      appointment.updatedAt = new Date(
        `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
      ).toISOString();
    }
  }
  return appointment;
}

function toUtcBasic(iso: string): string {
  return formatBasicUtc(new Date(iso));
}

function toRrule(recurrence: CalendarRecurrence, appointment: CalendarAppointment): string {
  const parts = [`FREQ=${FREQUENCY_TO_RRULE[recurrence.frequency]}`];
  if (recurrence.interval && recurrence.interval > 1) parts.push(`INTERVAL=${recurrence.interval}`);
  if (recurrence.count) parts.push(`COUNT=${recurrence.count}`);
  if (recurrence.until) {
    if (appointment.allDay) {
      parts.push(`UNTIL=${recurrence.until.replaceAll('-', '')}`);
    } else {
      const time = appointment.start.slice(11, 19);
      parts.push(`UNTIL=${toUtcBasic(`${recurrence.until}T${time}${appointment.start.slice(19) || ''}`)}`);
    }
  }
  if (recurrence.frequency === 'weekly' && recurrence.weekdays) {
    parts.push(`BYDAY=${recurrence.weekdays.map((day) => WEEKDAY_CODES[day]).join(',')}`);
  }
  return parts.join(';');
}

/** Serialize a local appointment as a VCALENDAR document with one VEVENT. */
export function toAppleIcs(appointment: CalendarAppointment, uid: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//A11yNotebook//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatBasicUtc(new Date())}`,
  ];
  if (appointment.updatedAt) {
    lines.push(`LAST-MODIFIED:${toUtcBasic(appointment.updatedAt)}`);
  }
  lines.push(`SUMMARY:${escapeText(appointment.title)}`);
  if (appointment.location) lines.push(`LOCATION:${escapeText(appointment.location)}`);
  if (appointment.description) lines.push(`DESCRIPTION:${escapeText(appointment.description)}`);
  if (appointment.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${appointment.start.replaceAll('-', '')}`);
    const end = appointment.end ?? addDaysToDateOnly(appointment.start, 1);
    lines.push(`DTEND;VALUE=DATE:${end.replaceAll('-', '')}`);
  } else {
    lines.push(`DTSTART:${toUtcBasic(appointment.start)}`);
    lines.push(`DTEND:${toUtcBasic(appointment.end ?? appointment.start)}`);
  }
  if (appointment.recurrence) {
    lines.push(`RRULE:${toRrule(appointment.recurrence, appointment)}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
