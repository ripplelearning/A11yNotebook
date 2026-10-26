import type { AppointmentInput, CalendarAppointment, CalendarRecurrence } from './calendar';

/**
 * Pure mapping between local calendar appointments and Microsoft Graph
 * event bodies. No network, no auth, no Electron APIs: the sync engine
 * owns transport and credentials, and this module is testable on its own.
 *
 * Time zones: the transport requests UTC (Prefer: outlook.timezone="UTC"),
 * so pulled dateTime values are UTC and pushed ones are sent as UTC. Pull
 * converts UTC back to local wall-clock time with the local offset, so a
 * push/pull round trip reproduces the stored string exactly and does not
 * manufacture a spurious conflict. All-day events are date-only on both
 * sides and are never converted.
 *
 * Known model mismatches, stated so a later reader does not mistake them
 * for bugs:
 * - Relative monthly/yearly recurrence ("second Tuesday") has no app
 *   equivalent, so such events are skipped on pull rather than shown
 *   with wrong dates. A skipped event is never deleted locally, but the
 *   app cannot display or edit it.
 * - Monthly series on day 29-31: the app clamps short months (Jan 31 ->
 *   Feb 28 -> Mar 31) while Graph uses the start day; the pattern carries
 *   no dayOfMonth adjustment for this.
 * - Local appointment links are not a Graph concept and are never sent.
 *   applySync preserves the local link when remote content wins.
 * - Outlook descriptions authored as HTML are flattened to text on pull;
 *   rich formatting does not round-trip.
 */

export interface OutlookDateTime {
  dateTime: string;
  timeZone?: string;
}

export interface OutlookRecurrencePattern {
  type: string;
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
}

export interface OutlookRecurrenceRange {
  type: string;
  startDate: string;
  endDate?: string;
  numberOfOccurrences?: number;
}

export interface OutlookEvent {
  id?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: OutlookDateTime;
  end?: OutlookDateTime;
  isAllDay?: boolean;
  recurrence?: { pattern?: OutlookRecurrencePattern; range?: OutlookRecurrenceRange };
  seriesMasterId?: string;
  lastModifiedDateTime?: string;
  '@removed'?: unknown;
}

const GRAPH_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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

/** UTC dateTime without offset, the shape Graph accepts with timeZone UTC. */
function toUtcDateTime(iso: string): string {
  const date = new Date(iso);
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** Graph dateTime values carry no offset under the UTC preference; read them as UTC. */
function parseGraphDateTime(value: string): Date {
  if (/([+-]\d{2}:?\d{2}|Z)$/.test(value)) return new Date(value);
  return new Date(`${value}Z`);
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function addDaysToDateOnly(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function startParts(appointment: CalendarAppointment): { year: number; month: number; day: number } {
  const [year, month, day] = datePart(appointment.start).split('-').map(Number);
  return { year, month, day };
}

function stripHtml(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toOutlookRecurrence(
  recurrence: CalendarRecurrence,
  appointment: CalendarAppointment,
): { pattern: OutlookRecurrencePattern; range: OutlookRecurrenceRange } {
  const start = startParts(appointment);
  let pattern: OutlookRecurrencePattern;
  if (recurrence.frequency === 'daily') {
    pattern = { type: 'daily', interval: recurrence.interval ?? 1 };
  } else if (recurrence.frequency === 'weekly') {
    const weekdays = recurrence.weekdays?.length
      ? recurrence.weekdays.map((day) => GRAPH_WEEKDAYS[day])
      : [GRAPH_WEEKDAYS[new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]];
    pattern = { type: 'weekly', interval: recurrence.interval ?? 1, daysOfWeek: weekdays };
  } else if (recurrence.frequency === 'monthly') {
    pattern = { type: 'absoluteMonthly', interval: recurrence.interval ?? 1, dayOfMonth: start.day };
  } else {
    pattern = {
      type: 'absoluteYearly',
      interval: recurrence.interval ?? 1,
      month: start.month,
      dayOfMonth: start.day,
    };
  }
  const startDate = datePart(appointment.start);
  let range: OutlookRecurrenceRange;
  if (recurrence.count !== undefined) {
    range = { type: 'numbered', startDate, numberOfOccurrences: recurrence.count };
  } else if (recurrence.until) {
    range = { type: 'endDate', startDate, endDate: recurrence.until };
  } else {
    range = { type: 'noEnd', startDate };
  }
  return { pattern, range };
}

export function toOutlookEvent(appointment: CalendarAppointment): OutlookEvent {
  const event: OutlookEvent = {
    subject: appointment.title,
    isAllDay: appointment.allDay,
  };
  if (appointment.description) {
    event.body = { contentType: 'text', content: appointment.description };
  }
  if (appointment.location) {
    event.location = { displayName: appointment.location };
  }
  if (appointment.allDay) {
    event.start = { dateTime: `${appointment.start}T00:00:00`, timeZone: 'UTC' };
    event.end = {
      dateTime: `${appointment.end ?? addDaysToDateOnly(appointment.start, 1)}T00:00:00`,
      timeZone: 'UTC',
    };
  } else {
    event.start = { dateTime: toUtcDateTime(appointment.start), timeZone: 'UTC' };
    event.end = { dateTime: toUtcDateTime(appointment.end ?? appointment.start), timeZone: 'UTC' };
  }
  if (appointment.recurrence) {
    event.recurrence = toOutlookRecurrence(appointment.recurrence, appointment);
  }
  return event;
}

function fromOutlookRecurrence(
  recurrence: NonNullable<OutlookEvent['recurrence']>,
): CalendarRecurrence | null {
  const pattern = recurrence.pattern;
  const range = recurrence.range;
  if (!pattern || !range) return null;
  let frequency: CalendarRecurrence['frequency'];
  let weekdays: number[] | undefined;
  if (pattern.type === 'daily') {
    frequency = 'daily';
  } else if (pattern.type === 'weekly') {
    frequency = 'weekly';
    if (pattern.daysOfWeek?.length) {
      weekdays = pattern.daysOfWeek
        .map((day) => GRAPH_WEEKDAYS.indexOf(day.toLowerCase()))
        .filter((day) => day >= 0)
        .sort((a, b) => a - b);
    }
  } else if (pattern.type === 'absoluteMonthly') {
    frequency = 'monthly';
  } else if (pattern.type === 'absoluteYearly') {
    frequency = 'yearly';
  } else {
    // Relative patterns and unknown types have no faithful app form.
    return null;
  }
  const result: CalendarRecurrence = { frequency, interval: pattern.interval ?? 1 };
  if (weekdays?.length) result.weekdays = weekdays;
  if (range.type === 'numbered' && range.numberOfOccurrences !== undefined) {
    result.count = range.numberOfOccurrences;
  } else if (range.type === 'endDate' && range.endDate) {
    result.until = datePart(range.endDate);
  }
  return result;
}

/**
 * Graph event -> local appointment input (no local id; the sync engine
 * assigns one). Returns null for events too incomplete to link (no id, no
 * usable start), for series instances (their master carries the series),
 * and for recurrence patterns the app cannot express.
 */
export function fromOutlookEvent(event: OutlookEvent): AppointmentInput | null {
  if (!event.id) return null;
  if (typeof event.seriesMasterId === 'string' && event.seriesMasterId) return null;
  const start = event.start;
  if (!start || !start.dateTime) return null;
  const allDay = event.isAllDay === true;
  const appointment: AppointmentInput = {
    title: event.subject?.trim() ? event.subject : '(No title)',
    start: allDay ? datePart(start.dateTime) : formatLocalDateTime(parseGraphDateTime(start.dateTime)),
    allDay,
    provider: 'outlook',
    externalId: event.id,
  };
  const end = event.end;
  if (allDay) {
    appointment.end = end?.dateTime ? datePart(end.dateTime) : addDaysToDateOnly(appointment.start, 1);
  } else if (end?.dateTime) {
    appointment.end = formatLocalDateTime(parseGraphDateTime(end.dateTime));
  }
  if (event.body?.content) {
    const text = event.body.contentType === 'html' ? stripHtml(event.body.content) : event.body.content;
    if (text) appointment.description = text;
  }
  if (event.location?.displayName) appointment.location = event.location.displayName;
  if (event.lastModifiedDateTime) appointment.updatedAt = event.lastModifiedDateTime;
  if (event.recurrence) {
    const recurrence = fromOutlookRecurrence(event.recurrence);
    if (!recurrence) return null;
    appointment.recurrence = recurrence;
  }
  return appointment;
}
