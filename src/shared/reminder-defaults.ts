import type { SnoozeDuration } from './reminders';

export interface ReminderDefaults {
  version: 1;
  time: string;
  snooze: SnoozeDuration;
  privacy: 'show-title' | 'hide-title';
  notification: {
    reminders: boolean;
    flashcards: boolean;
  };
}

export const DEFAULT_REMINDER_DEFAULTS: ReminderDefaults = {
  version: 1,
  time: '09:00',
  snooze: 15,
  privacy: 'show-title',
  notification: {
    reminders: true,
    flashcards: false,
  },
};

export function validateReminderDefaults(value: unknown): ReminderDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reminder defaults.');
  const defaults = value as Partial<ReminderDefaults>;
  if (
    defaults.version !== 1 ||
    typeof defaults.time !== 'string' ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(defaults.time) ||
    ![5, 15, 30, 60, 1440, 'tomorrow'].includes(defaults.snooze as SnoozeDuration) ||
    !['show-title', 'hide-title'].includes(defaults.privacy ?? '') ||
    !defaults.notification ||
    typeof defaults.notification !== 'object' ||
    Array.isArray(defaults.notification) ||
    typeof defaults.notification.reminders !== 'boolean' ||
    typeof defaults.notification.flashcards !== 'boolean'
  ) {
    throw new Error('Invalid reminder defaults.');
  }
  return {
    version: 1,
    time: defaults.time,
    snooze: defaults.snooze as SnoozeDuration,
    privacy: defaults.privacy as ReminderDefaults['privacy'],
    notification: {
      reminders: defaults.notification.reminders,
      flashcards: defaults.notification.flashcards,
    },
  };
}
