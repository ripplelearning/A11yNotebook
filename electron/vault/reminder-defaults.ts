import {
  DEFAULT_REMINDER_DEFAULTS,
  validateReminderDefaults,
  type ReminderDefaults,
} from '../../src/shared/reminder-defaults';
import type { CreateReminderInput } from '../../src/shared/reminders';

export function applyReminderDefaults(input: CreateReminderInput, defaults: ReminderDefaults): CreateReminderInput {
  return {
    ...input,
    privacy: input.privacy === undefined ? defaults.privacy : input.privacy,
    notification: input.notification === undefined ? defaults.notification.reminders : input.notification,
  };
}

export interface ReminderDefaultsStore {
  read(name: string): Promise<unknown>;
  write(name: string, value: unknown): Promise<void>;
}

export function createReminderDefaultsStore(metadata: ReminderDefaultsStore) {
  return {
    get: async (): Promise<ReminderDefaults> => {
      const value = await metadata.read('reminder-defaults.json');
      return validateReminderDefaults(value ?? DEFAULT_REMINDER_DEFAULTS);
    },
    set: async (value: unknown): Promise<ReminderDefaults> => {
      const validated = validateReminderDefaults(value);
      await metadata.write('reminder-defaults.json', validated);
      return validated;
    },
  };
}
