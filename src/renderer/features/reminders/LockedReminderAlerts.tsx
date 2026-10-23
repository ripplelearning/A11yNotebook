import { useEffect, useRef, useState } from 'react';
import type { Reminder } from '../../../shared/reminders';
import type { NotebookSettings } from '../../../shared/settings';
import ReminderAlertDialog from './ReminderAlertDialog';
import { playReminderSound } from './reminderSound';

interface Props {
  vaultPath: string;
  settings: NotebookSettings;
  announce: (message: string) => void;
}

// The locked alert never names a reminder; this placeholder only satisfies
// the shared dialog while its locked mode renders the generic text.
const GENERIC_REMINDER: Reminder = {
  id: 'locked-due',
  source: 'standalone',
  title: 'Reminder',
  path: '',
  scheduledAt: '1970-01-01T00:00:00.000Z',
  originalScheduledAt: '1970-01-01T00:00:00.000Z',
  status: 'fired',
  privacy: 'hide-title',
};

/**
 * Generic due alerts for a locked library. The reminder service is stopped
 * while locked, so the main process watches a privacy-safe snapshot of due
 * times and emits content-free 'locked-due' events; this component answers
 * them with the configured sound and the locked form of the alert dialog,
 * which reads "A reminder is due. Unlock the library to view it." and offers
 * no actions against the underlying reminders.
 */
export default function LockedReminderAlerts({ vaultPath, settings, announce }: Props) {
  const [due, setDue] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus() && !document.hidden);
  const current = useRef({ settings, announce });
  current.current = { settings, announce };

  useEffect(() => {
    const updateFocus = () => setFocused(document.hasFocus() && !document.hidden);
    window.addEventListener('focus', updateFocus);
    window.addEventListener('blur', updateFocus);
    document.addEventListener('visibilitychange', updateFocus);
    return () => {
      window.removeEventListener('focus', updateFocus);
      window.removeEventListener('blur', updateFocus);
      document.removeEventListener('visibilitychange', updateFocus);
    };
  }, []);

  useEffect(() => {
    setDue(false);
    const bridge = window.a11yNotebook?.vault;
    if (!bridge) return;
    let cancelled = false;
    const handleDue = (withSound: boolean) => {
      if (cancelled) return;
      setDue(true);
      if (withSound && current.current.settings.reminderSound) {
        void playReminderSound(current.current.settings).catch(() => {
          if (!cancelled) current.current.announce('Could not play reminder sound.');
        });
      }
    };
    const unsubscribe = bridge.onReminder((event) => {
      if (event.vaultPath !== vaultPath) return;
      if (event.type === 'locked-due') handleDue(true);
    });
    void bridge
      .reminderAlertsReady?.()
      .then((pending) => {
        if (pending?.some((event) => event.type === 'locked-due' && event.vaultPath === vaultPath)) {
          handleDue(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [vaultPath]);

  if (!due || !focused || settings.reminderAlerts !== true) return null;
  return (
    <ReminderAlertDialog
      reminder={GENERIC_REMINDER}
      count={1}
      locked
      onComplete={async () => undefined}
      onDismiss={async () => undefined}
      onSnooze={async () => undefined}
      onLater={() => setDue(false)}
    />
  );
}
