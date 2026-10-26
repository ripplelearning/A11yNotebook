/**
 * Calendar model: one library-wide calendar of appointments.
 *
 * Appointments are plain data so they can live in `calendar.json` next to
 * the other library metadata, travel with cloud-folder sync, and later map
 * onto Google, Outlook, and Apple Calendar events without a remodel.
 *
 * Time rules, kept deliberately simple:
 * - A timed appointment stores ISO datetimes with an offset
 *   (`2026-10-27T09:00:00-07:00`). Recurrence steps in local wall-clock
 *   time, so a daily 9:00 AM appointment stays 9:00 AM across DST.
 * - An all-day appointment stores plain dates (`2026-10-27`). When an
 *   all-day `end` is present it is the exclusive end date, Google-style:
 *   the appointment spans start through the day before end.
 * - Occurrences carry the same string shape as their appointment, so the
 *   UI never has to guess a timezone.
 */

export type CalendarLinkKind = 'note' | 'file' | 'task';

export interface CalendarLink {
  kind: CalendarLinkKind;
  /** Library-relative path of the note or file; the containing note for a task. */
  path: string;
  /** Task id, only when kind is 'task'. */
  taskId?: string;
}

export type CalendarRecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarRecurrence {
  frequency: CalendarRecurrenceFrequency;
  /** Repeat every N units; defaults to 1. */
  interval?: number;
  /** Stop after N occurrences, including the first. */
  count?: number;
  /** Last date on which an occurrence may start, YYYY-MM-DD. */
  until?: string;
  /** Days of the week (0 = Sunday) a weekly appointment repeats on. */
  weekdays?: number[];
}

export type CalendarSyncProvider = 'google' | 'outlook' | 'apple';

export interface CalendarAppointment {
  id: string;
  title: string;
  /** ISO datetime with offset, or YYYY-MM-DD when allDay. */
  start: string;
  /** ISO datetime with offset, or exclusive YYYY-MM-DD when allDay. */
  end?: string;
  allDay: boolean;
  description?: string;
  location?: string;
  /** Optional link to a note, file, or task. Absent means standalone. */
  link?: CalendarLink;
  recurrence?: CalendarRecurrence;
  /** Sync bookkeeping, filled in by the sync phases; unused locally. */
  provider?: CalendarSyncProvider;
  externalId?: string;
  updatedAt?: string;
}

export interface CalendarOccurrence {
  appointmentId: string;
  title: string;
  allDay: boolean;
  /** Same string shape as the appointment's start. */
  start: string;
  /** Same string shape as the appointment's end; absent for instant events. */
  end?: string;
  link?: CalendarLink;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$/;
const FREQUENCIES: CalendarRecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
const LINK_KINDS: CalendarLinkKind[] = ['note', 'file', 'task'];
const PROVIDERS: CalendarSyncProvider[] = ['google', 'outlook', 'apple'];

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

export function parseDateOnly(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

function parseDateTimeParts(value: unknown): DateParts | null {
  if (typeof value !== 'string' || !DATE_TIME.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
    second: parsed.getSeconds(),
  };
}

/** Parse either a date-only or a datetime string into local wall-clock parts. */
export function parseAppointmentTime(value: unknown): DateParts | null {
  return parseDateOnly(value) ?? parseDateTimeParts(value);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateOnly(parts: DateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function localOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function formatDateTime(parts: DateParts): string {
  const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (
    `${formatDateOnly(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` +
    localOffset(date)
  );
}

function toDate(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Local YYYY-MM-DD key for a parsed date, used to group occurrences by day. */
export function dateKeyFromParts(parts: DateParts): string {
  return formatDateOnly(parts);
}

/** Shift a YYYY-MM-DD date by a number of days, or null for an invalid date. */
export function shiftDateText(dateText: string, days: number): string | null {
  const parts = parseDateOnly(dateText);
  if (!parts) return null;
  const shifted = new Date(parts.year, parts.month - 1, parts.day + days);
  return formatDateOnly(fromDate(shifted));
}

/** Combine a YYYY-MM-DD date and HH:mm time into a local ISO datetime with offset. */
export function combineDateTime(dateText: string, timeText: string): string | null {
  const parts = parseDateOnly(dateText);
  if (!parts || !/^\d{2}:\d{2}$/.test(timeText)) return null;
  const hour = Number(timeText.slice(0, 2));
  const minute = Number(timeText.slice(3, 5));
  if (hour > 23 || minute > 59) return null;
  const candidate: DateParts = { ...parts, hour, minute, second: 0 };
  const probe = toDate(candidate);
  if (probe.getHours() !== hour || probe.getMinutes() !== minute) return null;
  return formatDateTime(candidate);
}

function fromDate(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function compareParts(a: DateParts, b: DateParts): number {
  const keys: (keyof DateParts)[] = ['year', 'month', 'day', 'hour', 'minute', 'second'];
  for (const key of keys) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

function dateOnlyOf(parts: DateParts): DateParts {
  return { ...parts, hour: 0, minute: 0, second: 0 };
}

function addDays(parts: DateParts, days: number): DateParts {
  const date = toDate(parts);
  date.setDate(date.getDate() + days);
  return fromDate(date);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addMonths(parts: DateParts, months: number): DateParts {
  const total = (parts.year * 12 + (parts.month - 1) + months) % 12;
  const year = Math.floor((parts.year * 12 + (parts.month - 1) + months) / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(parts.day, daysInMonth(year, month + 1));
  return { year, month: month + 1, day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function addYears(parts: DateParts, years: number): DateParts {
  const year = parts.year + years;
  const day = parts.month === 2 && parts.day === 29 && daysInMonth(year, 2) === 28 ? 28 : parts.day;
  return { year, month: parts.month, day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function cleanLink(value: unknown): CalendarLink | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const link = value as CalendarLink;
  if (!LINK_KINDS.includes(link.kind) || typeof link.path !== 'string' || !link.path) return undefined;
  if (link.kind === 'task' && (typeof link.taskId !== 'string' || !link.taskId)) return undefined;
  return link.kind === 'task' ? { kind: link.kind, path: link.path, taskId: link.taskId } : { kind: link.kind, path: link.path };
}

function cleanRecurrence(value: unknown): CalendarRecurrence | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const recurrence = value as CalendarRecurrence;
  if (!FREQUENCIES.includes(recurrence.frequency)) return undefined;
  const cleaned: CalendarRecurrence = { frequency: recurrence.frequency };
  if (Number.isInteger(recurrence.interval) && (recurrence.interval as number) >= 1) {
    cleaned.interval = recurrence.interval;
  }
  if (Number.isInteger(recurrence.count) && (recurrence.count as number) >= 1) {
    cleaned.count = recurrence.count;
  }
  if (parseDateOnly(recurrence.until)) cleaned.until = recurrence.until;
  if (recurrence.frequency === 'weekly' && Array.isArray(recurrence.weekdays)) {
    const weekdays = [...new Set(recurrence.weekdays)].filter(
      (day): day is number => Number.isInteger(day) && day >= 0 && day <= 6,
    );
    if (weekdays.length) cleaned.weekdays = weekdays.sort((a, b) => a - b);
  }
  return cleaned;
}

/** Validate one stored appointment; returns null when the core fields are unusable. */
export function cleanAppointment(value: unknown): CalendarAppointment | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as CalendarAppointment;
  if (typeof item.id !== 'string' || !item.id) return null;
  if (typeof item.title !== 'string' || !item.title.trim()) return null;
  if (typeof item.allDay !== 'boolean') return null;
  const start = item.allDay ? parseDateOnly(item.start) : parseAppointmentTime(item.start);
  if (!start) return null;
  let end: DateParts | null = null;
  if (item.end !== undefined) {
    end = item.allDay ? parseDateOnly(item.end) : parseAppointmentTime(item.end);
    if (!end) return null;
    if (compareParts(end, start) < 0) return null;
  }
  const cleaned: CalendarAppointment = {
    id: item.id,
    title: item.title,
    start: item.start,
    allDay: item.allDay,
  };
  if (item.end !== undefined) cleaned.end = item.end;
  if (typeof item.description === 'string' && item.description) cleaned.description = item.description;
  if (typeof item.location === 'string' && item.location) cleaned.location = item.location;
  const link = cleanLink(item.link);
  if (link) cleaned.link = link;
  const recurrence = cleanRecurrence(item.recurrence);
  if (recurrence) cleaned.recurrence = recurrence;
  if (item.provider !== undefined && PROVIDERS.includes(item.provider)) cleaned.provider = item.provider;
  if (typeof item.externalId === 'string' && item.externalId) cleaned.externalId = item.externalId;
  if (typeof item.updatedAt === 'string' && item.updatedAt) cleaned.updatedAt = item.updatedAt;
  return cleaned;
}

/** Filter a stored calendar file down to usable appointments. */
export function cleanAppointments(value: unknown): CalendarAppointment[] {
  if (!Array.isArray(value)) return [];
  const cleaned: CalendarAppointment[] = [];
  for (const item of value) {
    const appointment = cleanAppointment(item);
    if (appointment) cleaned.push(appointment);
  }
  return cleaned;
}

const MAX_OCCURRENCES = 2000;
const MAX_STEPS = 20000;

function occurrenceRange(appointment: CalendarAppointment, start: DateParts): { start: DateParts; end: DateParts } {
  const startParts = parseAppointmentTime(appointment.start);
  const endParts = appointment.end !== undefined ? parseAppointmentTime(appointment.end) : null;
  if (appointment.allDay) {
    const startDay = dateOnlyOf(start);
    if (endParts && compareParts(dateOnlyOf(endParts), startDay) > 0) {
      // Exclusive end date: the event spans start through the day before end.
      return { start: startDay, end: dateOnlyOf(endParts) };
    }
    return { start: startDay, end: addDays(startDay, 1) };
  }
  if (!startParts || !endParts) return { start, end: start };
  const durationMs = toDate(endParts).getTime() - toDate(startParts).getTime();
  const endDate = new Date(toDate(start).getTime() + Math.max(0, durationMs));
  return { start, end: fromDate(endDate) };
}

/**
 * Generate the starts of a recurring series in local wall-clock time.
 * Weekly appointments with weekdays step week by week; every other
 * frequency steps by its own unit. Stops at count, until, or the cap.
 */
function recurrenceStarts(appointment: CalendarAppointment, anchor: DateParts): DateParts[] {
  const recurrence = appointment.recurrence;
  if (!recurrence) return [anchor];
  const interval = recurrence.interval ?? 1;
  const until = recurrence.until !== undefined ? parseDateOnly(recurrence.until) : null;
  const starts: DateParts[] = [];
  let steps = 0;
  if (recurrence.frequency === 'weekly' && recurrence.weekdays && recurrence.weekdays.length) {
    const anchorSunday = addDays(dateOnlyOf(anchor), -toDate(anchor).getDay());
    for (let week = 0; steps < MAX_STEPS && starts.length < MAX_OCCURRENCES; week += interval) {
      let advanced = false;
      for (const weekday of recurrence.weekdays) {
        const candidate = addDays(anchorSunday, week * 7 + weekday);
        const timed = { ...candidate, hour: anchor.hour, minute: anchor.minute, second: anchor.second };
        if (until && compareParts(dateOnlyOf(timed), until) > 0) return starts;
        if (recurrence.count !== undefined && starts.length >= recurrence.count) return starts;
        if (compareParts(timed, anchor) >= 0) {
          starts.push(timed);
          advanced = true;
        }
      }
      steps += 1;
      if (!advanced && week > 0 && recurrence.count === undefined && !until) break;
      if (until && compareParts(dateOnlyOf(addDays(anchorSunday, week * 7)), until) > 0) break;
    }
    return starts;
  }
  // Monthly and yearly steps anchor on the original date, so January 31st
  // repeats as February 28th then March 31st instead of drifting to the 28th.
  let step = 0;
  while (steps < MAX_STEPS && starts.length < MAX_OCCURRENCES) {
    const candidate =
      recurrence.frequency === 'daily'
        ? addDays(anchor, step * interval)
        : recurrence.frequency === 'weekly'
          ? addDays(anchor, step * 7 * interval)
          : recurrence.frequency === 'monthly'
            ? addMonths(anchor, step * interval)
            : addYears(anchor, step * interval);
    if (until && compareParts(dateOnlyOf(candidate), until) > 0) break;
    if (recurrence.count !== undefined && starts.length >= recurrence.count) break;
    starts.push(candidate);
    steps += 1;
    step += 1;
  }
  return starts;
}

/**
 * Expand appointments into the occurrences overlapping [rangeStart, rangeEnd).
 * Timed occurrences carry ISO datetimes; all-day occurrences carry dates,
 * one per spanned day for multi-day events. Results are sorted by start.
 */
export function expandAppointments(
  appointments: CalendarAppointment[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarOccurrence[] {
  const rangeStartParts = fromDate(rangeStart);
  const rangeEndParts = fromDate(rangeEnd);
  const occurrences: CalendarOccurrence[] = [];
  for (const appointment of appointments) {
    const anchor = parseAppointmentTime(appointment.start);
    if (!anchor) continue;
    for (const start of recurrenceStarts(appointment, anchor)) {
      if (occurrences.length >= MAX_OCCURRENCES) break;
      const range = occurrenceRange(appointment, start);
      // Starts arrive in ascending order, so an occurrence starting at or
      // after the range end means every later one does too.
      if (compareParts(range.end, rangeStartParts) <= 0) continue;
      if (compareParts(range.start, rangeEndParts) >= 0) break;
      if (appointment.allDay) {
        // One occurrence per spanned day, so the agenda shows the event
        // on every day it covers.
        let day = range.start;
        while (compareParts(day, range.end) < 0) {
          const dayStart = { ...day, hour: 0, minute: 0, second: 0 };
          const dayEnd = addDays(dayStart, 1);
          if (compareParts(dayEnd, rangeStartParts) > 0 && compareParts(dayStart, rangeEndParts) < 0) {
            occurrences.push({
              appointmentId: appointment.id,
              title: appointment.title,
              allDay: true,
              start: formatDateOnly(dayStart),
              end: formatDateOnly(dayEnd),
              link: appointment.link,
            });
          }
          day = addDays(day, 1);
        }
      } else {
        occurrences.push({
          appointmentId: appointment.id,
          title: appointment.title,
          allDay: false,
          start: formatDateTime(range.start),
          end: appointment.end !== undefined ? formatDateTime(range.end) : undefined,
          link: appointment.link,
        });
      }
    }
  }
  occurrences.sort((a, b) => {
    const aParts = parseAppointmentTime(a.start);
    const bParts = parseAppointmentTime(b.start);
    if (aParts && bParts) {
      const order = compareParts(aParts, bParts);
      if (order !== 0) return order;
    }
    return a.title.localeCompare(b.title);
  });
  return occurrences;
}
