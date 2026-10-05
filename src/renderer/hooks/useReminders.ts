import { useEffect, useRef, useState } from 'react';
import type { Reminder } from '../../shared/reminders';
import { DEFAULT_REMINDER_DEFAULTS, type ReminderDefaults } from '../../shared/reminder-defaults';

export function useReminders(
  vaultPath: string | undefined,
  onOpen: (path: string) => void,
  announce: (message: string) => void,
) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [defaults, setDefaults] = useState<ReminderDefaults>(DEFAULT_REMINDER_DEFAULTS);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    const bridge = window.a11yNotebook?.vault;
    setReminders([]);
    setDefaults(DEFAULT_REMINDER_DEFAULTS);
    if (!vaultPath || !bridge?.getReminders) return;
    let cancelled = false;
    if (typeof bridge.getReminderDefaults === 'function') {
      void bridge
        .getReminderDefaults()
        .then((value) => {
          if (!cancelled) setDefaults(value);
        })
        .catch(() => {
          if (!cancelled) announce('Could not load reminder defaults.');
        });
    }
    void bridge
      .getReminders()
      .then((items) => {
        if (cancelled) return;
        setReminders(items);
        const missed = items.filter((item) => item.status === 'fired' && Date.parse(item.scheduledAt) <= Date.now());
        if (missed.length) announce(`${missed.length} fired or missed reminders are available in Reminders.`);
      })
      .catch(() => {
        if (!cancelled) announce('Could not load reminders.');
      });
    const unsubscribe = bridge.onReminder((event) => {
      if (cancelled || event.vaultPath !== vaultPath) return;
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
  const saveDefaults = async (value: ReminderDefaults) => {
    const save = window.a11yNotebook?.vault.setReminderDefaults;
    if (!save) throw new Error('Reminder defaults are unavailable.');
    const saved = await save(value);
    setDefaults(saved);
  };
  return { reminders, setReminders, defaults, saveDefaults };
}
