import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  backupFolderName,
  copyLibrary,
  resolveBackupDestination,
  sanitizeBackupName,
  type LibraryBackupResult,
} from './library-backup';

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Create one automatic whole-library backup: an exact byte copy, like the
 * manual backup, so encrypted files stay encrypted and no plaintext
 * temporary copy is made. A blank folder means a Backups folder next to
 * the library. Afterwards, older automatic backups of this library beyond
 * keepCount are deleted, oldest first. Backup folder names carry a
 * timestamp, so they sort chronologically.
 */
export async function createAutoBackup(
  libraryPath: string,
  libraryName: string,
  folder: string,
  keepCount: number,
): Promise<LibraryBackupResult> {
  const root = path.resolve(libraryPath);
  const parent = folder.trim()
    ? path.resolve(folder.trim())
    : path.join(path.dirname(root), 'A11yNotebook Backups');
  if (isInside(parent, root) || isInside(root, parent)) {
    throw new Error('Automatic backups must live outside the library folder.');
  }
  await mkdir(parent, { recursive: true });
  const destination = await resolveBackupDestination(parent, libraryName);
  const copied = await copyLibrary(root, destination);
  await pruneAutoBackups(parent, libraryName, keepCount);
  return copied;
}

async function pruneAutoBackups(parent: string, libraryName: string, keepCount: number): Promise<void> {
  const prefix = `${sanitizeBackupName(libraryName)} backup `;
  const entries = await readdir(parent, { withFileTypes: true });
  const backups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  const excess = backups.slice(0, Math.max(0, backups.length - keepCount));
  for (const name of excess) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
}

/** A folder name counts as an automatic backup of this library. */
export function isAutoBackupFolder(name: string, libraryName: string): boolean {
  return name.startsWith(`${sanitizeBackupName(libraryName)} backup `);
}

export { backupFolderName };
