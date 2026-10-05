import {
  DEFAULT_REMINDER_DEFAULTS,
  validateReminderDefaults,
  type ReminderDefaults,
} from '../../src/shared/reminder-defaults';

export interface ReminderDefaultsStore {
  read(name: string): Promise<unknown>;
  write(name: string, value: unknown): Promise<void>;
}

export function createReminderDefaultsStore(metadata: ReminderDefaultsStore) {
  return {
    get: async (): Promise<ReminderDefaults> => {
      const value = await metadata.read('reminder-defaults.json');
      return value === null || value === undefined ? { ...DEFAULT_REMINDER_DEFAULTS } : validateReminderDefaults(value);
    },
    set: async (value: unknown): Promise<ReminderDefaults> => {
      const validated = validateReminderDefaults(value);
      await metadata.write('reminder-defaults.json', validated);
      return validated;
    },
  };
}
