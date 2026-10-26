import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dateKeyFromParts,
  expandAppointments,
  parseAppointmentTime,
  type CalendarAppointment,
  type CalendarOccurrence,
} from '../../../shared/calendar';
import type { VaultTask } from '../../../shared/types';
import AppointmentDialog from './AppointmentDialog';
import type { AppointmentInput } from '../../../shared/calendar';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDaysTo(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fullDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function monthName(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

function occurrenceDayKey(occurrence: CalendarOccurrence): string {
  const parts = parseAppointmentTime(occurrence.start);
  return parts ? dateKeyFromParts(parts) : '';
}

function formatTime(occurrence: CalendarOccurrence): string {
  if (occurrence.allDay) return 'All day';
  const start = parseAppointmentTime(occurrence.start);
  if (!start) return '';
  const startDate = new Date(start.year, start.month - 1, start.day, start.hour, start.minute);
  const startText = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!occurrence.end) return startText;
  const end = parseAppointmentTime(occurrence.end);
  if (!end) return startText;
  const endDate = new Date(end.year, end.month - 1, end.day, end.hour, end.minute);
  return `${startText} – ${endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export default function CalendarScreen({
  title = 'Calendar',
  vaultPath,
  notePaths,
  filePaths,
  isCurrent,
  onOpenEntry,
  announce,
}: {
  title?: string;
  vaultPath: string;
  notePaths: string[];
  filePaths: string[];
  isCurrent: () => boolean;
  onOpenEntry: (path: string) => Promise<void>;
  announce: (message: string) => void;
}) {
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'agenda' | 'month'>('agenda');
  const [agendaAnchor, setAgendaAnchor] = useState(() => atMidnight(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(() => atMidnight(new Date()));
  const [dialog, setDialog] = useState<{ appointment?: CalendarAppointment } | null>(null);
  const alive = useRef(false);
  const operation = useRef(false);
  const request = useRef(0);
  const currentRef = useRef(isCurrent);
  currentRef.current = isCurrent;
  const current = useCallback(() => alive.current && currentRef.current(), []);
  const bridge = window.a11yNotebook?.vault;
  const available = !!(bridge?.getCalendar && bridge?.saveCalendar && bridge?.getTasks);

  const refresh = useCallback(async () => {
    if (!current() || operation.current) return;
    const version = ++request.current;
    setLoading(true);
    try {
      if (!bridge?.getCalendar || !bridge?.getTasks)
        throw new Error('The calendar is unavailable in this version.');
      const [items, latestTasks] = await Promise.all([bridge.getCalendar(), bridge.getTasks()]);
      if (!current() || version !== request.current) return;
      setAppointments(items);
      setTasks(latestTasks);
      setError('');
    } catch (reason) {
      if (current() && version === request.current)
        setError(reason instanceof Error ? reason.message : 'Could not load the calendar.');
    } finally {
      if (current() && version === request.current) setLoading(false);
    }
  }, [bridge, current]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = bridge?.onChanged?.((event) => {
      if (event.vaultPath === vaultPath) void refresh();
    });
    const unsubscribeLock = bridge?.onSecurityLocked?.(() => {
      alive.current = false;
      request.current += 1;
      setAppointments([]);
      setTasks([]);
      setDialog(null);
    });
    return () => {
      alive.current = false;
      unsubscribe?.();
      unsubscribeLock?.();
    };
  }, [bridge, refresh, vaultPath]);

  async function saveAppointment(input: AppointmentInput, existingId?: string) {
    if (!bridge?.saveCalendar) throw new Error('The calendar is unavailable in this version.');
    operation.current = true;
    try {
      const updated = existingId
        ? appointments.map((item) => (item.id === existingId ? { ...input, id: existingId } : item))
        : [...appointments, { ...input, id: crypto.randomUUID() }];
      await bridge.saveCalendar(updated);
      setAppointments(updated);
      setNotice(existingId ? 'Appointment updated.' : 'Appointment created.');
      announce(existingId ? 'Appointment updated.' : 'Appointment created.');
    } finally {
      operation.current = false;
    }
  }

  async function deleteAppointment(id: string) {
    if (!bridge?.saveCalendar) throw new Error('The calendar is unavailable in this version.');
    operation.current = true;
    try {
      const updated = appointments.filter((item) => item.id !== id);
      await bridge.saveCalendar(updated);
      setAppointments(updated);
      setNotice('Appointment deleted.');
      announce('Appointment deleted.');
    } finally {
      operation.current = false;
    }
  }

  function openLink(occurrence: CalendarOccurrence) {
    const link = occurrence.link;
    if (!link) return;
    void onOpenEntry(link.path).catch(() => {
      setError('The linked item is no longer available.');
    });
  }

  function renderOccurrence(occurrence: CalendarOccurrence) {
    const appointment = appointments.find((item) => item.id === occurrence.appointmentId);
    const link = occurrence.link;
    let linkLabel = '';
    let linkAvailable = false;
    if (link) {
      if (link.kind === 'task') {
        const task = tasks.find((item) => item.path === link.path && (item.taskId ?? item.id) === link.taskId);
        linkLabel = task ? `Open linked task: ${task.text}` : `Open linked note: ${basename(link.path)}`;
        linkAvailable = true;
      } else if (link.kind === 'note' ? notePaths.includes(link.path) : filePaths.includes(link.path)) {
        linkLabel = `Open linked ${link.kind}: ${basename(link.path)}`;
        linkAvailable = true;
      }
    }
    return (
      <li key={`${occurrence.appointmentId}-${occurrence.start}`}>
        <span>{formatTime(occurrence)} </span>
        <strong>{occurrence.title}</strong>
        {appointment?.location && <span> — {appointment.location}</span>}
        {appointment?.description && <span> — {appointment.description}</span>}
        {appointment && (
          <button type="button" onClick={() => setDialog({ appointment })}>
            Edit {occurrence.title}
          </button>
        )}
        {link && linkAvailable && (
          <button type="button" onClick={() => openLink(occurrence)}>
            {linkLabel}
          </button>
        )}
        {link && !linkAvailable && <span> Linked item is no longer available.</span>}
      </li>
    );
  }

  function renderAgenda() {
    const windowEnd = addDaysTo(agendaAnchor, 30);
    const occurrences = expandAppointments(appointments, agendaAnchor, windowEnd);
    const groups = new Map<string, { date: Date; items: CalendarOccurrence[] }>();
    for (const occurrence of occurrences) {
      const key = occurrenceDayKey(occurrence);
      if (!key) continue;
      const parts = parseAppointmentTime(occurrence.start);
      if (!parts) continue;
      const date = new Date(parts.year, parts.month - 1, parts.day);
      const group = groups.get(key) ?? { date, items: [] };
      group.items.push(occurrence);
      groups.set(key, group);
    }
    return (
      <section aria-label="Agenda">
        <div>
          <button type="button" onClick={() => setAgendaAnchor((current) => addDaysTo(current, -30))}>
            Previous 30 days
          </button>
          <button type="button" onClick={() => setAgendaAnchor(atMidnight(new Date()))}>
            Today
          </button>
          <button type="button" onClick={() => setAgendaAnchor((current) => addDaysTo(current, 30))}>
            Next 30 days
          </button>
        </div>
        {[...groups.values()].map((group) => (
          <section key={dayKey(group.date)} aria-label={fullDate(group.date)}>
            <h2>{fullDate(group.date)}</h2>
            <ul>{group.items.map((item) => renderOccurrence(item))}</ul>
          </section>
        ))}
        {!groups.size && <p>No appointments in this period.</p>}
      </section>
    );
  }

  function renderMonth() {
    const first = new Date(monthCursor.year, monthCursor.month, 1);
    const gridStart = addDaysTo(first, -first.getDay());
    const gridEnd = addDaysTo(gridStart, 42);
    const occurrences = expandAppointments(appointments, gridStart, gridEnd);
    const counts = new Map<string, number>();
    for (const occurrence of occurrences) {
      const key = occurrenceDayKey(occurrence);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const selectedKey = dayKey(selectedDay);
    const selectedOccurrences = occurrences.filter((item) => occurrenceDayKey(item) === selectedKey);
    const shiftMonth = (delta: number) => {
      const shifted = new Date(monthCursor.year, monthCursor.month + delta, 1);
      setMonthCursor({ year: shifted.getFullYear(), month: shifted.getMonth() });
      setSelectedDay(new Date(shifted.getFullYear(), shifted.getMonth(), 1));
    };
    const weeks: Date[][] = [];
    for (let week = 0; week < 6; week += 1) {
      const days: Date[] = [];
      for (let day = 0; day < 7; day += 1) days.push(addDaysTo(gridStart, week * 7 + day));
      weeks.push(days);
    }
    return (
      <section aria-label="Month grid">
        <div>
          <button type="button" onClick={() => shiftMonth(-1)}>
            Previous month
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setMonthCursor({ year: now.getFullYear(), month: now.getMonth() });
              setSelectedDay(atMidnight(now));
            }}
          >
            Today
          </button>
          <button type="button" onClick={() => shiftMonth(1)}>
            Next month
          </button>
        </div>
        <table>
          <caption>{monthName(monthCursor.year, monthCursor.month)}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((day) => (
                <th key={day} scope="col">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, weekIndex) => (
              <tr key={weekIndex}>
                {week.map((date) => {
                  const key = dayKey(date);
                  const count = counts.get(key) ?? 0;
                  return (
                    <td key={key}>
                      <button
                        type="button"
                        aria-pressed={key === selectedKey}
                        aria-label={`${fullDate(date)}, ${count === 0 ? 'no appointments' : `${count} appointment${count === 1 ? '' : 's'}`}`}
                        onClick={() => {
                          setSelectedDay(date);
                          if (date.getMonth() !== monthCursor.month)
                            setMonthCursor({ year: date.getFullYear(), month: date.getMonth() });
                        }}
                      >
                        {date.getDate()}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <section aria-label={`Appointments on ${fullDate(selectedDay)}`}>
          <h2>Appointments on {fullDate(selectedDay)}</h2>
          {selectedOccurrences.length ? (
            <ul>{selectedOccurrences.map((item) => renderOccurrence(item))}</ul>
          ) : (
            <p>No appointments on this day.</p>
          )}
        </section>
      </section>
    );
  }

  return (
    <section>
      <h1>{title}</h1>
      {loading && <p>Loading calendar…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!available && <p>The calendar is unavailable in this version.</p>}
      {available && !loading && (
        <>
          <div>
            <button type="button" onClick={() => setDialog({})}>
              New appointment
            </button>
            <button type="button" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>
              Agenda
            </button>
            <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>
              Month grid
            </button>
          </div>
          {view === 'agenda' ? renderAgenda() : renderMonth()}
        </>
      )}
      {dialog && (
        <AppointmentDialog
          appointment={dialog.appointment}
          notePaths={notePaths}
          filePaths={filePaths}
          tasks={tasks}
          onSave={(input) => saveAppointment(input, dialog.appointment?.id)}
          onDelete={dialog.appointment ? (id) => deleteAppointment(id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
