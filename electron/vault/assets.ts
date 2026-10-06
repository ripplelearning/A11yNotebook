import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { assetTypes, createAssetRegistry, parseFlashcards, type CardSchedule } from '../../src/shared/assets';
import type { createMetadataStore } from './metadata';

interface Resolver {
  resolveEntry(relative: string, missing?: boolean): Promise<string>;
}

export function validateSchedule(value: unknown): CardSchedule {
  const data = value as CardSchedule | null;
  if (
    !data ||
    !Number.isInteger(data.repetitions) ||
    data.repetitions < 0 ||
    data.repetitions > 100000 ||
    !Number.isInteger(data.interval) ||
    data.interval < 0 ||
    data.interval > 1000000 ||
    typeof data.ease !== 'number' ||
    !Number.isFinite(data.ease) ||
    data.ease < 1.3 ||
    data.ease > 10 ||
    typeof data.due !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.due) ||
    !Number.isFinite(Date.parse(data.due)) ||
    new Date(data.due).toISOString().slice(0, 10) !== data.due
  )
    throw new Error('Invalid flashcard schedule.');
  return { repetitions: data.repetitions, interval: data.interval, ease: data.ease, due: data.due };
}

export function createAssetStore(vault: Resolver, metadata: ReturnType<typeof createMetadataStore>) {
  const registry = createAssetRegistry(assetTypes);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };
  function assetType(relative: unknown) {
    if (typeof relative !== 'string') throw new Error('Invalid asset path.');
    const type = registry.resolve(relative);
    if (!type) throw new Error('Use .outline.md, .mindmap.json, .cards.md, .csv, or .grid.md.');
    return type;
  }
  async function read(relative: string) {
    const type = assetType(relative);
    const target = await vault.resolveEntry(relative);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Assets must be files smaller than 2 MB.');
    const content = await readFile(target, 'utf8');
    type.parse(content);
    return { path: relative, type: type.id, content };
  }
  function fingerprint(question: string, answer: string) {
    return createHash('sha256')
      .update(JSON.stringify([question, answer]))
      .digest('hex');
  }
  async function schedules() {
    const raw = await metadata.read('flashcards.json');
    if (!raw) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid flashcard metadata.');
    return raw as Record<string, Record<string, CardSchedule>>;
  }
  return {
    read,
    save: (relative: string, content: string, expected: string) =>
      serial(async () => {
        const type = assetType(relative);
        if (typeof content !== 'string' || content.length > 2 * 1024 * 1024 || typeof expected !== 'string')
          throw new Error('Invalid asset content.');
        type.parse(content);
        const target = await vault.resolveEntry(relative);
        if ((await read(relative)).content !== expected)
          throw new Error('Asset changed on disk. Reload before saving; copy your changes first.');
        await writeFile(target, content, 'utf8');
      }),
    create: (relative: string, content: string) =>
      serial(async () => {
        const type = assetType(relative);
        if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) throw new Error('Invalid asset content.');
        type.parse(content);
        const target = await vault.resolveEntry(relative, true);
        await writeFile(target, content, { flag: 'wx' });
      }),
    getSchedules: async (relative: string): Promise<Record<string, CardSchedule>> => {
      if (assetType(relative).id !== 'flashcards') throw new Error('Choose a flashcard deck.');
      const cards = parseFlashcards((await read(relative)).content);
      const stored = (await schedules())[relative] ?? {};
      return Object.fromEntries(
        cards.flatMap((card) => {
          const schedule = stored[fingerprint(card.question, card.answer)];
          return schedule ? [[card.id, validateSchedule(schedule)]] : [];
        }),
      );
    },
    getScheduledFlashcards: async () => {
      const stored = await schedules();
      const due: Array<{ id: string; path: string; cardId: string; due: string }> = [];
      for (const [relative, records] of Object.entries(stored)) {
        if (assetType(relative).id !== 'flashcards') continue;
        try {
          const cards = parseFlashcards((await read(relative)).content);
          for (const card of cards) {
            const fingerprintValue = fingerprint(card.question, card.answer);
            const schedule = records[fingerprintValue];
            if (!schedule) continue;
            const validated = validateSchedule(schedule);
            due.push({
              id: `flashcard:${relative}#${fingerprintValue}`,
              path: relative,
              cardId: card.id,
              due: validated.due,
            });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
      }
      return due;
    },
    saveSchedule: (relative: string, cardId: string, value: unknown, expected: string) =>
      serial(async () => {
        if (assetType(relative).id !== 'flashcards' || typeof cardId !== 'string' || typeof expected !== 'string')
          throw new Error('Invalid deck.');
        const source = (await read(relative)).content;
        if (source !== expected) throw new Error('The deck changed. Reload before reviewing.');
        const card = parseFlashcards(source).find((item) => item.id === cardId);
        if (!card) throw new Error('Card not found.');
        const stored = await schedules();
        const updated = {
          ...(stored[relative] ?? {}),
          [fingerprint(card.question, card.answer)]: validateSchedule(value),
        };
        await metadata.write('flashcards.json', { ...stored, [relative]: updated });
      }),
  };
}
