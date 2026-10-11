// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBoundedMetadata } from '../../electron/vault/metadata-protection';

// Windows does not enforce O_NOFOLLOW. Exercise that behavior on every CI platform.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: 0 } };
});

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('bounded metadata reads without O_NOFOLLOW support', () => {
  it('reads regular files and rejects oversized files and directories', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'a11y-bounded-read-'));
    folders.push(folder);
    const source = path.join(folder, 'container.json');
    await writeFile(source, '{}');
    expect(await readBoundedMetadata(source, 2)).toBe('{}');
    await expect(readBoundedMetadata(source, 1)).rejects.toThrow('container');
    const directory = path.join(folder, 'directory');
    await mkdir(directory);
    await expect(readBoundedMetadata(directory)).rejects.toThrow('container');
  });

  it('rejects a symlink to an otherwise valid file', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'a11y-bounded-read-'));
    folders.push(folder);
    const source = path.join(folder, 'container.json');
    await writeFile(source, '{}');
    const link = path.join(folder, 'linked.json');
    await symlink(source, link, 'file');
    await expect(readBoundedMetadata(link)).rejects.toThrow('container');
  });
});
