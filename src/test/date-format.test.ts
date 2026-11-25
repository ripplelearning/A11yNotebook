import { describe, expect, it } from 'vitest';
import {
  displayDateText,
  normalizeDateText,
  parseDisplayDate,
} from '../shared/calendar';
import { formatTaskDueDate, isValidDateText } from '../shared/reminders';

/**
 * Dates the user sees and types are MM/DD/YYYY, everywhere. Storage
 * stays ISO (YYYY-MM-DD) internally; these helpers are the boundary.
 */
describe('MM/DD/YYYY date display', () => {
  it('parses a typed MM/DD/YYYY date and rejects impossible dates', () => {
    expect(parseDisplayDate('11/01/2026')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    expect(parseDisplayDate('2/3/2026')).toEqual({
      year: 2026,
      month: 2,
      day: 3,
      hour: 0,
      minute: 0,
      second: 0,
    });
    expect(parseDisplayDate('02/30/2026')).toBeNull();
    expect(parseDisplayDate('13/01/2026')).toBeNull();
    expect(parseDisplayDate('11/01/26')).toBeNull();
    expect(parseDisplayDate('2026/11/01')).toBeNull();
  });

  it('still parses a stored ISO date, so existing data keeps working', () => {
    expect(parseDisplayDate('2026-11-01')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    expect(parseDisplayDate('2026-02-30')).toBeNull();
  });

  it('normalizes a typed date to ISO for storage and back to display', () => {
    expect(normalizeDateText('11/01/2026')).toBe('2026-11-01');
    expect(normalizeDateText('2/3/2026')).toBe('2026-02-03');
    expect(normalizeDateText('2026-11-01')).toBe('2026-11-01');
    expect(normalizeDateText('02/30/2026')).toBeNull();
    expect(normalizeDateText('not a date')).toBeNull();
    expect(displayDateText('2026-11-01')).toBe('11/01/2026');
    expect(displayDateText('2026-02-03')).toBe('02/03/2026');
    expect(displayDateText('')).toBe('');
  });

  it('validates typed dates in MM/DD/YYYY and still accepts stored ISO', () => {
    expect(isValidDateText('11/01/2026')).toBe(true);
    expect(isValidDateText('02/30/2026')).toBe(false);
    expect(isValidDateText('2026-11-01')).toBe(true);
    expect(isValidDateText('2026-02-30')).toBe(false);
    expect(isValidDateText('11/01/26')).toBe(false);
  });

  it('shows a task due date as MM/DD/YYYY, never ISO or dashes', () => {
    expect(formatTaskDueDate('2026-11-07', '14:30')).toBe('11/07/2026 at 2:30 PM');
    expect(formatTaskDueDate('2026-11-07', '09:30')).toBe('11/07/2026 at 9:30 AM');
    expect(formatTaskDueDate('2026-11-07', undefined)).toBe('11/07/2026');
    expect(formatTaskDueDate(undefined, undefined)).toBe('No due date');
  });
});
