import { useId, useState } from 'react';
import type { CalendarAppointment } from '../../../shared/calendar';
import type { SyncConflict } from '../../../shared/calendar-sync';
import type { ConflictChoice } from '../../../shared/google-sync-run';
import Modal from '../../components/Modal';

function formatWhen(appointment: CalendarAppointment): string {
  if (appointment.allDay) return `All day ${appointment.start}`;
  const parsed = Date.parse(appointment.start);
  return Number.isNaN(parsed) ? appointment.start : new Date(parsed).toLocaleString();
}

function formatRecurrence(appointment: CalendarAppointment): string | null {
  const recurrence = appointment.recurrence;
  if (!recurrence) return null;
  const interval = recurrence.interval ?? 1;
  return `Repeats ${recurrence.frequency}${interval > 1 ? ` every ${interval}` : ''}`;
}

function VersionDetails({ appointment }: { appointment: CalendarAppointment }) {
  const recurrence = formatRecurrence(appointment);
  return (
    <>
      <p>
        {appointment.title} — {formatWhen(appointment)}
      </p>
      {appointment.location && <p>Location: {appointment.location}</p>}
      {appointment.description && <p>Description: {appointment.description}</p>}
      {recurrence && <p>{recurrence}</p>}
    </>
  );
}

export default function ConflictResolutionDialog({
  conflicts,
  onResolve,
  onClose,
  providerLabel = 'Google',
}: {
  conflicts: SyncConflict[];
  onResolve: (conflict: SyncConflict, choice: ConflictChoice) => Promise<void>;
  onClose: () => void;
  providerLabel?: string;
}) {
  const id = useId();
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function resolve(conflict: SyncConflict, choice: ConflictChoice): Promise<void> {
    if (resolving !== null) return;
    setResolving(conflict.local.id);
    setError('');
    try {
      await onResolve(conflict, choice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not resolve this conflict.');
    } finally {
      setResolving(null);
    }
  }

  return (
    <Modal titleId={`${id}-title`} title="Resolve sync conflicts" onClose={onClose}>
      <p>
        Each appointment below changed both in this library and in {providerLabel}. Choose which
        version to keep; the other side is updated to match, so the next sync no longer reports it.
      </p>
      {error && <p role="alert">{error}</p>}
      {conflicts.length === 0 && <p>All conflicts resolved.</p>}
      {conflicts.map((conflict) => (
        <section key={conflict.local.id} aria-labelledby={`${id}-${conflict.local.id}`}>
          <h3 id={`${id}-${conflict.local.id}`}>{conflict.local.title}</h3>
          <h4>Local version</h4>
          <VersionDetails appointment={conflict.local} />
          <h4>{providerLabel} version</h4>
          <VersionDetails appointment={conflict.remote} />
          <button
            type="button"
            disabled={resolving !== null}
            onClick={() => void resolve(conflict, 'local')}
          >
            Keep local version
          </button>{' '}
          <button
            type="button"
            disabled={resolving !== null}
            onClick={() => void resolve(conflict, 'remote')}
          >
            Take {providerLabel} version
          </button>
        </section>
      ))}
      <div>
        <button type="button" disabled={resolving !== null} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
