// @vitest-environment node
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupFolderName,
  copyLibrary,
  resolveBackupDestination,
  sanitizeBackupName,
  walkLibraryFiles,
} from '../../electron/vault/library-backup';

const directories: string[] = [];

async function folder() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'a11y-backup-test-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('library backup', () => {
  it('copies every file byte-for-byte, including private metadata, and verifies the copy', async () => {
    const root = await folder();
    const parent = await folder();
    await mkdir(path.join(root, 'Research'), { recursive: true });
    await mkdir(path.join(root, '.a11ynotebook'), { recursive: true });
    await writeFile(path.join(root, 'Research', 'Idea.md'), '# Idea\n');
    await writeFile(path.join(root, '.a11ynotebook', 'search-index.json'), '{"version":4}');
    await writeFile(path.join(root, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    const destination = await resolveBackupDestination(parent, 'Study', new Date('2026-10-24T18:00:00.000Z'));
    const result = await copyLibrary(root, destination);
    expect(result.files).toBe(3);
    expect(result.bytes).toBeGreaterThan(0);
    expect(await readFile(path.join(destination, 'Research', 'Idea.md'), 'utf8')).toBe('# Idea\n');
    expect(await readFile(path.join(destination, 'photo.png'))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    expect(await readFile(path.join(destination, '.a11ynotebook', 'search-index.json'), 'utf8')).toBe('{"version":4}');
    expect(await walkLibraryFiles(destination)).toEqual(await walkLibraryFiles(root));
  });

  it('refuses a destination inside the library and one that contains it', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'Note.md'), 'hi');
    await expect(copyLibrary(root, path.join(root, 'backup'))).rejects.toThrow(/neither inside/);
    await expect(copyLibrary(root, path.dirname(root))).rejects.toThrow(/neither inside/);
  });

  it('refuses symlinked files and leaves no partial backup behind', async () => {
    const root = await folder();
    const parent = await folder();
    const outside = await folder();
    await writeFile(path.join(outside, 'real.md'), 'real');
    await writeFile(path.join(root, 'Note.md'), 'hi');
    await symlink(path.join(outside, 'real.md'), path.join(root, 'Link.md'));
    const destination = await resolveBackupDestination(parent, 'Study');
    await expect(copyLibrary(root, destination)).rejects.toThrow(/Symbolic links/);
    await expect(access(destination)).rejects.toThrow();
  });

  it('picks an unused timestamped folder name instead of overwriting', async () => {
    const parent = await folder();
    const first = await resolveBackupDestination(parent, 'Study', new Date('2026-10-24T18:00:00.000Z'));
    await mkdir(first, { recursive: true });
    const second = await resolveBackupDestination(parent, 'Study', new Date('2026-10-24T18:00:00.000Z'));
    expect(second).not.toBe(first);
    expect(path.basename(second)).toMatch(/-2$/);
  });

  it('builds a Windows-safe folder name from the library name', async () => {
    expect(backupFolderName('My:Library?', new Date('2026-10-24T18:00:00.000Z'))).toBe(
      'My_Library_ backup 20261024-180000',
    );
    expect(sanitizeBackupName('')).toBe('Library');
    const stat = await lstat(path.join(os.tmpdir()));
    expect(stat.isDirectory()).toBe(true);
  });
});
