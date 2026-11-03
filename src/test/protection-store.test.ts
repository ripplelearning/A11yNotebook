// @vitest-environment node
import { mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createProtectionStore } from '../../electron/vault/protection';

const dirs: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(live?: () => Promise<Set<string>>) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'a11y-protection-')));
  dirs.push(dir);
  const resolver = {
    resolveMetadata: async (name: string) => join(dir, name),
  };
  return { dir, store: createProtectionStore(resolver, live) };
}

describe('protection store', () => {
  it('round-trips a file and a directory flag', async () => {
    const { dir, store } = await tempStore();
    const file = join(dir, 'Note.md');
    const folder = join(dir, 'Work');
    await writeFile(file, 'hello');
    await mkdir(folder);
    expect(await store.get(file)).toBe(false);
    await store.set(file, true);
    await store.set(folder, true);
    expect(await store.get(file)).toBe(true);
    expect(await store.get(folder)).toBe(true);
    await store.set(file, false);
    expect(await store.get(file)).toBe(false);
    expect(await store.get(folder)).toBe(true);
  });

  it('keeps protection across a rename, because identity is not path-based', async () => {
    const { dir, store } = await tempStore();
    const before = join(dir, 'Old.md');
    const after = join(dir, 'New.md');
    await writeFile(before, 'hello');
    await store.set(before, true);
    await rename(before, after);
    expect(await store.get(after)).toBe(true);
  });

  it('forgets records and prunes identities that are no longer live', async () => {
    const { dir, store } = await tempStore(async () => new Set());
    const file = join(dir, 'Note.md');
    await writeFile(file, 'hello');
    await store.set(file, true);
    expect(await store.get(file)).toBe(true);
    const key = await store.identity(file);
    expect(key).not.toBeNull();
    await store.forget([key as string]);
    expect(await store.get(file)).toBe(false);
    await store.set(file, true);
    await store.prune();
    expect(await store.get(file)).toBe(false);
  });

  it('never protects a symlink', async () => {
    const { dir, store } = await tempStore();
    const target = join(dir, 'Target.md');
    const link = join(dir, 'Link.md');
    await writeFile(target, 'hello');
    await symlink(target, link);
    await store.set(link, true);
    expect(await store.get(link)).toBe(false);
    expect(await store.identity(link)).toBeNull();
  });

  it('persists a versioned envelope on disk', async () => {
    const { dir, store } = await tempStore();
    const file = join(dir, 'Note.md');
    await writeFile(file, 'hello');
    await store.set(file, true);
    await store.flush();
    const { readFile } = await import('node:fs/promises');
    const raw = JSON.parse(await readFile(join(dir, 'protection.json'), 'utf8')) as {
      version: unknown;
      records: Record<string, unknown>;
    };
    expect(raw.version).toBe(1);
    expect(Object.values(raw.records)).toEqual([true]);
  });
});
