import { useEffect, useRef, useState } from 'react';
import type { Reminder, SnoozeDuration } from '../../../shared/reminders';
import type { NotebookSettings } from '../../../shared/settings';
import ReminderAlertDialog from './ReminderAlertDialog';
import { playReminderSound, stopReminderSound } from './reminderSound';

interface Props {
  vaultPath: string;
  settings: NotebookSettings;
  blocked: boolean;
  onComplete: (reminder: Reminder) => Promise<void>;
  announce: (message: string) => void;
}

export default function ReminderAlerts({ vaultPath, settings, blocked, onComplete, announce }: Props) {
  const [queue, setQueue] = useState<Reminder[]>([]);
  const [focused, setFocused] = useState(() => document.hasFocus() && !document.hidden);
  const current = useRef({ settings, announce });
  const returnFocus = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  current.current = { settings, announce };
  useEffect(() => {
    const updateFocus = () => {
      if (
        queueRef.current.length &&
        document.hasFocus() &&
        !returnFocus.current &&
        document.activeElement instanceof HTMLElement
      ) {
        returnFocus.current = document.activeElement;
      }
      setFocused(document.hasFocus() && !document.hidden);
    };
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
    setQueue([]);
    returnFocus.current = null;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge) return;
    active.current = true;
    let cancelled = false;
    const seen = new Set<string>();
    const add = (reminder: Reminder, sound: boolean) => {
      const key = `${reminder.id}:${reminder.scheduledAt}`;
      if (cancelled || seen.has(key)) return;
      seen.add(key);
      if (current.current.settings.reminderAlerts === true) {
        if (!returnFocus.current && document.hasFocus() && document.activeElement instanceof HTMLElement) {
          returnFocus.current = document.activeElement;
        }
        setQueue((items) => [...items, reminder]);
      }
      if (sound && current.current.settings.reminderSound) {
        void playReminderSound(current.current.settings).catch(() => {
          if (!cancelled) current.current.announce('Could not play reminder sound.');
        });
      }
    };
    const replay = async () => {
      const pending = await bridge.reminderAlertsReady?.();
      if (cancelled) return;
      for (const event of pending ?? []) {
        if (event.type === 'fired' && event.vaultPath === vaultPath) add(event.reminder, true);
      }
    };
    const unsubscribe = bridge.onReminder((event) => {
      if (cancelled || event.vaultPath !== vaultPath) return;
      if (event.type === 'fired') {
        add(event.reminder, true);
        void replay().catch(() => undefined);
      }
      if (event.type === 'changed') {
        setQueue((items) =>
          items.filter((item) =>
            event.reminders.some(
              (next) => next.id === item.id && next.status === 'fired' && next.scheduledAt === item.scheduledAt,
            ),
          ),
        );
      }
    });
    // Startup fired reminders are a silent catch-up, never a second native notification or sound.
    void replay()
      .then(() =>
        Promise.all([
          cancelled ? Promise.resolve([] as Reminder[]) : bridge.getReminders(),
          cancelled ? Promise.resolve(undefined) : bridge.getReminderDefaults?.(),
        ]),
      )
      .then(([items, defaults]) => {
        if (cancelled) return;
        for (const item of items.filter((entry) => entry.status === 'fired')) {
          add(
            item.privacy === 'hide-title' || (item.source === 'task' && defaults?.privacy === 'hide-title')
              ? { ...item, title: 'Reminder', privacy: 'hide-title' }
              : item,
            false,
          );
        }
      })
      .catch(() => {
        if (!cancelled) current.current.announce('Could not load reminder alerts.');
      });
    return () => {
      cancelled = true;
      active.current = false;
      unsubscribe();
      stopReminderSound();
    };
  }, [vaultPath]);
  const reminder = queue[0];
  const remove = (message: string) => {
    if (queue.length === 1) returnFocus.current = null;
    setQueue((items) => items.filter((item) => item.id !== reminder.id));
    announce(message);
  };
  const act = async (operation: () => Promise<unknown>, message: string) => {
    await operation();
    if (active.current) remove(message);
  };
  const snooze = (duration: SnoozeDuration) =>
    act(() => window.a11yNotebook!.vault.snoozeReminder(reminder.id, duration), 'Reminder snoozed.');
  if (!focused || blocked || !reminder || settings.reminderAlerts !== true) return null;
  return (
    <ReminderAlertDialog
      key={`${reminder.id}:${reminder.scheduledAt}`}
      reminder={reminder}
      count={queue.length}
      restoreFocusTo={returnFocus.current}
      onComplete={() => act(() => onComplete(reminder), 'Reminder completed.')}
      onDismiss={() => act(() => window.a11yNotebook!.vault.dismissReminder(reminder.id), 'Reminder dismissed.')}
      onSnooze={snooze}
      onLater={() => remove('Reminder alert closed. The reminder remains in Reminders.')}
    />
  );
}
