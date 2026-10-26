import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAutoBackup } from '../../electron/vault/auto-backup';

const roots: string[] = [];

async function makeLibrary(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'a11y-library-'));
  roots.push(root);
  await writeFile(path.join(root, 'note.md'), '# Hello');
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'file.txt'), 'data');
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('automatic backups', () => {
  it('copies the whole library into a timestamped folder', async () => {
    const library = await makeLibrary();
    const parent = await mkdtemp(path.join(tmpdir(), 'a11y-backups-'));
    roots.push(parent);
    const result = await createAutoBackup(library, 'My Library', parent, 5);
    expect(result.files).toBe(2);
    expect(await readFile(path.join(result.path, 'note.md'), 'utf8')).toBe('# Hello');
    expect(await readFile(path.join(result.path, 'sub', 'file.txt'), 'utf8')).toBe('data');
  });

  it('keeps only the newest backups', async () => {
    const library = await makeLibrary();
    const parent = await mkdtemp(path.join(tmpdir(), 'a11y-backups-'));
    roots.push(parent);
    await createAutoBackup(library, 'My Library', parent, 2);
    await createAutoBackup(library, 'My Library', parent, 2);
    await createAutoBackup(library, 'My Library', parent, 2);
    const entries = (await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    expect(entries).toHaveLength(2);
  });

  it('refuses a backup folder inside the library', async () => {
    const library = await makeLibrary();
    await expect(createAutoBackup(library, 'My Library', path.join(library, 'backups'), 5)).rejects.toThrow(
      'outside the library',
    );
  });

  it('uses a Backups folder next to the library when no folder is given', async () => {
    const library = await makeLibrary();
    roots.push(path.join(path.dirname(library), 'A11yNotebook Backups'));
    const result = await createAutoBackup(library, 'My Library', '', 5);
    expect(result.path).toContain('A11yNotebook Backups');
  });
});
