import { expandAppointments, type CalendarAppointment } from './calendar';
import type { Reminder } from './reminders';

/**
 * Appointment reminders, mapped from stored appointments to the reminder
 * service's Reminder shape. Timed appointments only: all-day starts have
 * no time to count back from.
 *
 * Occurrences come from expandAppointments over the next 31 days, which
 * also includes an occurrence already in progress (its end is still
 * ahead). Fully past occurrences are excluded, so a stale appointment
 * never fires. If nothing falls in the window, the single next occurrence
 * is included instead: without it the service would arm no timer and a
 * far-future appointment's reminder would never wake up. The service
 * re-collects on every fire and every library change, so later
 * occurrences appear as the window slides.
 */
export const APPOINTMENT_REMINDER_WINDOW_DAYS = 31;

export function appointmentReminders(
  appointments: CalendarAppointment[],
  now = new Date(),
): Reminder[] {
  const windowEnd = new Date(now.getTime() + APPOINTMENT_REMINDER_WINDOW_DAYS * 86400_000);
  const farEnd = new Date(now.getTime() + 5 * 365 * 86400_000);
  const out: Reminder[] = [];
  for (const appointment of appointments) {
    if (appointment.reminderMinutesBefore === undefined || appointment.allDay) continue;
    let occurrences = expandAppointments([appointment], now, windowEnd);
    if (occurrences.length === 0) {
      occurrences = expandAppointments([appointment], now, farEnd).slice(0, 1);
    }
    for (const occurrence of occurrences) {
      const startMs = Date.parse(occurrence.start);
      if (Number.isNaN(startMs)) continue;
      const scheduledAt = new Date(
        startMs - appointment.reminderMinutesBefore * 60_000,
      ).toISOString();
      out.push({
        id: `appointment:${appointment.id}:${occurrence.start}`,
        source: 'appointment',
        title: appointment.title || 'Appointment',
        scheduledAt,
        originalScheduledAt: scheduledAt,
        status: 'pending',
      });
    }
  }
  return out.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}
