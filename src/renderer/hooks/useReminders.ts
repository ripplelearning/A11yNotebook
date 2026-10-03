import { useEffect, useRef, useState } from 'react';
import type { Reminder } from '../../shared/reminders';

export function useReminders(
  vaultPath: string | undefined,
  onOpen: (path: string) => void,
  announce: (message: string) => void,
) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    const bridge = window.a11yNotebook?.vault;
    setReminders([]);
    if (!vaultPath || !bridge?.getReminders) return;
    let cancelled = false;
    void bridge
      .getReminders()
      .then((items) => {
        if (cancelled) return;
        setReminders(items);
        const missed = items.filter((item) => item.status === 'fired' && Date.parse(item.scheduledAt) <= Date.now());
        if (missed.length) announce(`${missed.length} fired or missed reminders are available in Reminders.`);
      })
      .catch(() => announce('Could not load reminders.'));
    const unsubscribe = bridge.onReminder((event) => {
      if (event.vaultPath !== vaultPath) return;
      if (event.type === 'changed' && event.reminders) setReminders(event.reminders);
      if (event.type === 'fired' && event.reminder) announce(`Reminder: ${event.reminder.title}`);
      if (event.type === 'open' && event.reminder) openRef.current(event.reminder.path);
      if (event.type === 'error') announce(event.message ?? 'Could not update reminders.');
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [vaultPath, announce]);
  return { reminders, setReminders };
}
