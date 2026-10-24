// @vitest-environment node
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFolder,
  inspectPasteSource,
  organizeLibraryOrphans,
  resolveUniqueFolder,
} from '../../electron/vault/paste';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

async function fixture(): Promise<string> {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-paste-'));
  const source = path.join(temporaryDirectory, 'Pasted');
  await mkdir(path.join(source, 'Sub'), { recursive: true });
  await writeFile(path.join(source, 'loose.txt'), 'loose');
  await writeFile(path.join(source, 'Sub', 'inner.md'), 'inner');
  return source;
}

describe('paste planning and copying', () => {
  it('lists a folder direct children and copies it verified', async () => {
    const source = await fixture();
    const info = await inspectPasteSource(source);
    expect(info).toEqual({ kind: 'folder', name: 'Pasted', folders: ['Sub'], files: ['loose.txt'] });
    const destination = path.join(temporaryDirectory, 'Copy');
    const copied = await copyFolder(source, destination);
    expect(copied.files).toBe(2);
    expect(await readFile(path.join(destination, 'Sub', 'inner.md'), 'utf8')).toBe('inner');
  });

  it('rejects a destination inside the source', async () => {
    const source = await fixture();
    await expect(copyFolder(source, path.join(source, 'Inside'))).rejects.toThrow('inside itself');
  });

  it('finds unused folder names with numeric suffixes', async () => {
    await fixture();
    const parent = temporaryDirectory;
    expect(await resolveUniqueFolder(parent, 'Pasted')).toBe(path.join(parent, 'Pasted-2'));
    expect(await resolveUniqueFolder(parent, 'Fresh')).toBe(path.join(parent, 'Fresh'));
  });

  it('organizes orphan files into one notebook or one per file', async () => {
    await fixture();
    const library = path.join(temporaryDirectory, 'Library');
    await mkdir(library, { recursive: true });
    await writeFile(path.join(library, 'a.txt'), 'a');
    await writeFile(path.join(library, 'b.txt'), 'b');
    const one = await organizeLibraryOrphans(library, ['a.txt', 'b.txt'], 'one');
    expect(one).toEqual(['Pasted files']);
    expect(await lstat(path.join(library, 'Pasted files', 'a.txt'))).toBeTruthy();
    await writeFile(path.join(library, 'c.txt'), 'c');
    const perFile = await organizeLibraryOrphans(library, ['c.txt'], 'per-file');
    expect(perFile).toEqual(['c']);
    expect(await lstat(path.join(library, 'c', 'c.txt'))).toBeTruthy();
  });

  it('describes a single file source', async () => {
    const source = await fixture();
    const file = path.join(source, 'loose.txt');
    expect(await inspectPasteSource(file)).toEqual({ kind: 'file', name: 'loose.txt', folders: [], files: [] });
  });
});
