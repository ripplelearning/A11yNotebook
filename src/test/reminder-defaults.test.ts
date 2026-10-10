// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetadataStore } from '../../electron/vault/metadata';
import { applyReminderDefaults, createReminderDefaultsStore } from '../../electron/vault/reminder-defaults';
import { createReminderService } from '../../electron/vault/reminders';
import { createVaultService } from '../../electron/vault/service';
import { DEFAULT_REMINDER_DEFAULTS, validateReminderDefaults } from '../shared/reminder-defaults';

let temporary = '';
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

describe('reminder defaults', () => {
  it('returns independent defaults for missing metadata', async () => {
    const store = createReminderDefaultsStore({ read: async () => null, write: vi.fn() });
    const first = await store.get();
    first.notification.flashcards = true;
    expect(await store.get()).toEqual(DEFAULT_REMINDER_DEFAULTS);
    expect(DEFAULT_REMINDER_DEFAULTS.notification.flashcards).toBe(false);
  });

  it('persists all choices through the atomic metadata store and reopening', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'a11y-defaults-'));
    const vault = createVaultService(temporary);
    await vault.initialize();
    const defaults = {
      ...DEFAULT_REMINDER_DEFAULTS,
      time: '23:59',
      snooze: 'tomorrow' as const,
      privacy: 'hide-title' as const,
      notification: { reminders: false, flashcards: true },
    };
    const store = createReminderDefaultsStore(createMetadataStore(vault));
    expect(await store.set(defaults)).toEqual(defaults);
    expect(await createReminderDefaultsStore(createMetadataStore(vault)).get()).toEqual(defaults);
  });

  it.each([
    null,
    [],
    {},
    { ...DEFAULT_REMINDER_DEFAULTS, version: 2 },
    { ...DEFAULT_REMINDER_DEFAULTS, time: '24:00' },
    { ...DEFAULT_REMINDER_DEFAULTS, time: '9:00' },
    { ...DEFAULT_REMINDER_DEFAULTS, snooze: 45 },
    { ...DEFAULT_REMINDER_DEFAULTS, privacy: 'secret' },
    { ...DEFAULT_REMINDER_DEFAULTS, notification: { reminders: true } },
    { ...DEFAULT_REMINDER_DEFAULTS, notification: { reminders: 'true', flashcards: false } },
  ])('rejects invalid settings without writing: %j', async (value) => {
    const write = vi.fn();
    expect(() => validateReminderDefaults(value)).toThrow('Invalid reminder defaults');
    await expect(createReminderDefaultsStore({ read: async () => value, write }).set(value)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects corrupt persisted settings instead of resetting them', async () => {
    const store = createReminderDefaultsStore({ read: async () => ({ version: 2 }), write: vi.fn() });
    await expect(store.get()).rejects.toThrow('Invalid reminder defaults');
  });

  it('applies only missing creation choices and does not rewrite existing reminders', async () => {
    const metadata = new Map<string, unknown>();
    const store = createReminderDefaultsStore({
      read: async (name) => metadata.get(name),
      write: async (name, value) => {
        metadata.set(name, structuredClone(value));
      },
    });
    const service = createReminderService({
      readStore: async () => null,
      writeStore: async () => undefined,
      getNotes: async () => [],
      validateNote: async () => undefined,
      notify: vi.fn(),
      now: () => new Date('2026-10-03T10:00:00Z'),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    await service.initialize();
    const input = { title: 'Meeting', path: 'Study.md', scheduledAt: '2026-10-04T10:00:00Z' };
    try {
      const [original] = await service.createReminder(applyReminderDefaults(input, await store.get()));
      await store.set({
        ...DEFAULT_REMINDER_DEFAULTS,
        time: '12:30',
        privacy: 'hide-title',
        notification: { reminders: false, flashcards: true },
      });
      expect(await service.getReminders()).toEqual([original]);
      expect(applyReminderDefaults(input, await store.get())).toMatchObject({
        scheduledAt: input.scheduledAt,
        privacy: 'hide-title',
        notification: false,
      });
      expect(
        applyReminderDefaults({ ...input, privacy: 'show-title', notification: true }, await store.get()),
      ).toMatchObject({ privacy: 'show-title', notification: true });
      expect(input).not.toHaveProperty('privacy');
    } finally {
      service.stop();
    }
  });
});
