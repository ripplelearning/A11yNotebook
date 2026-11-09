import { describe, expect, it } from 'vitest';
import type { CalendarAppointment } from '../shared/calendar';
import type { Reminder } from '../shared/reminders';
import { searchTasksRemindersAppointments, type VaultSearchQuery } from '../shared/search';
import type { VaultTask } from '../shared/types';

const tasks: VaultTask[] = [
  { id: 't1', path: 'Research/Note.md', text: 'Review the accessibility report', complete: false, dueDate: '2026-11-10', priority: 'high' },
  { id: 't2', path: 'Research/Note.md', text: 'Buy milk', complete: true },
  { id: 't3', path: 'Archive/Old.md', text: 'Review the old plan', complete: false },
  { id: 't4', path: 'Loose.md', text: 'Review loose ends', complete: false },
];

const reminders: Reminder[] = [
  {
    id: 'r1',
    source: 'task',
    title: 'Review the report',
    path: 'Research/Note.md',
    scheduledAt: '2026-11-08T09:00:00-08:00',
    originalScheduledAt: '2026-11-08T09:00:00-08:00',
    status: 'pending',
  },
  {
    id: 'r2',
    source: 'appointment',
    title: 'Dentist checkup',
    scheduledAt: '2026-11-09T10:00:00-08:00',
    originalScheduledAt: '2026-11-09T10:00:00-08:00',
    status: 'pending',
  },
];

const appointments: CalendarAppointment[] = [
  {
    id: 'a1',
    title: 'Team review meeting',
    start: '2026-11-10T14:00:00-08:00',
    allDay: false,
    location: 'Room 4',
    description: 'Quarterly accessibility review',
  },
  { id: 'a2', title: 'Dentist', start: '2026-11-09', allDay: true },
];

function search(query: VaultSearchQuery) {
  return searchTasksRemindersAppointments(query, { tasks, reminders, appointments });
}

describe('searchTasksRemindersAppointments', () => {
  it('matches tasks, reminders, and appointments on the query text', () => {
    const results = search({ text: 'review' });
    expect(results.map((result) => `${result.kind}:${result.title}`)).toEqual([
      'task:Review the accessibility report',
      'task:Review the old plan',
      'task:Review loose ends',
      'reminder:Review the report',
      'appointment:Team review meeting',
    ]);
  });

  it('requires every term to match', () => {
    expect(search({ text: 'review report' }).map((result) => result.title)).toEqual([
      'Review the accessibility report',
      'Review the report',
    ]);
  });

  it('filters by kind', () => {
    expect(search({ text: 'review', kind: 'task' }).map((result) => result.kind)).toEqual([
      'task',
      'task',
      'task',
    ]);
    expect(search({ text: 'dentist', kind: 'reminder' }).map((result) => result.title)).toEqual([
      'Dentist checkup',
    ]);
    expect(search({ text: 'dentist', kind: 'appointment' }).map((result) => result.title)).toEqual(['Dentist']);
  });

  it('lists everything of a kind when the text is empty', () => {
    expect(search({ text: '', kind: 'task' })).toHaveLength(4);
    expect(search({ text: '', kind: 'appointment' })).toHaveLength(2);
  });

  it('matches the notebook filter by the containing notebook, including nested notebooks', () => {
    expect(search({ text: 'review', notebook: 'Research' }).map((result) => result.title)).toEqual([
      'Review the accessibility report',
      'Review the report',
    ]);
    // Appointments belong to no notebook, so a notebook filter excludes them.
    expect(search({ text: 'dentist', notebook: 'Research' }).map((result) => result.title)).toEqual([]);
    expect(search({ text: 'dentist' }).map((result) => result.title)).toEqual(['Dentist checkup', 'Dentist']);
  });

  it('excludes the new kinds when a tag or modified-date filter is set', () => {
    expect(search({ text: 'review', tag: 'work' })).toEqual([]);
    expect(search({ text: 'review', modifiedAfter: '2026-01-01' })).toEqual([]);
    expect(search({ text: 'review', modifiedBefore: '2026-12-31' })).toEqual([]);
  });

  it('carries the opening target and context for each kind', () => {
    const [task] = search({ text: 'milk', kind: 'task' });
    expect(task.targetId).toBe('t2');
    expect(task.path).toBe('Research/Note.md');
    expect(task.notebook).toBe('Research');
    const [reminder] = search({ text: 'checkup', kind: 'reminder' });
    expect(reminder.targetId).toBe('r2');
    expect(reminder.snippet).toMatch(/Reminder at \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} [AP]M/);
    expect(reminder.snippet).not.toContain('2026-11-09T10:00:00');
    const [appointment] = search({ text: 'Team review', kind: 'appointment' });
    expect(appointment.targetId).toBe('a1');
    expect(appointment.snippet).toContain('Room 4');
    expect(appointment.snippet).toMatch(/\d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} [AP]M/);
    const [due] = search({ text: 'accessibility report', kind: 'task' });
    expect(due.snippet).toContain('Due 11-10-2026');
    expect(due.snippet).not.toContain('2026-11-10');
    expect(due.snippet).toContain('high priority');
  });
});
