import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export interface LibraryFileEntry {
  relative: string;
  size: number;
}

export interface LibraryBackupResult {
  path: string;
  files: number;
  bytes: number;
}

/**
 * A whole-library backup is an exact byte copy of the library folder,
 * including its private metadata folder. Encrypted files stay encrypted
 * in the copy: nothing is decrypted, and no plaintext temporary copy is
 * made. A backup therefore opens as a library in its own right.
 */
export function sanitizeBackupName(name: string): string {
  const illegal = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const cleaned = name
    .split('')
    .map((character) => (character.charCodeAt(0) <= 31 || illegal.has(character) ? '_' : character))
    .join('')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'Library';
}

export function backupFolderName(libraryName: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 15).replace(' ', '-');
  return `${sanitizeBackupName(libraryName)} backup ${stamp}`;
}

export async function resolveBackupDestination(parent: string, libraryName: string, now = new Date()): Promise<string> {
  const base = backupFolderName(libraryName, now);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = path.join(parent, attempt === 0 ? base : `${base}-${attempt + 1}`);
    try {
      await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw error;
    }
  }
  throw new Error('Could not find an unused backup folder name.');
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function walkLibraryFiles(root: string): Promise<LibraryFileEntry[]> {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error('Library root must remain a regular folder.');
  const files: LibraryFileEntry[] = [];
  async function walk(relativeDirectory: string): Promise<void> {
    const directory = relativeDirectory ? path.join(root, relativeDirectory) : root;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported in library paths: ${relative}`);
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (entry.isFile()) {
        const stat = await lstat(path.join(root, relative));
        if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in library paths: ${relative}`);
        files.push({ relative, size: stat.size });
      }
    }
  }
  await walk('');
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

export async function copyLibrary(source: string, destination: string): Promise<LibraryBackupResult> {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (sourceRoot === destinationRoot) throw new Error('Choose a backup location outside the library.');
  if (isInside(destinationRoot, sourceRoot) || isInside(sourceRoot, destinationRoot))
    throw new Error('Choose a backup location that is neither inside the library nor containing it.');
  const parentStat = await lstat(path.dirname(destinationRoot)).catch(() => null);
  if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory())
    throw new Error('Choose an existing folder to contain the backup.');
  try {
    await lstat(destinationRoot);
    throw new Error('The backup folder already exists. Choose another location.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const files = await walkLibraryFiles(sourceRoot);
  try {
    await mkdir(destinationRoot, { recursive: true });
    for (const file of files) {
      const target = path.join(destinationRoot, file.relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(sourceRoot, file.relative), target);
    }
    const copied = await walkLibraryFiles(destinationRoot);
    if (
      copied.length !== files.length ||
      copied.some((entry, index) => entry.relative !== files[index].relative || entry.size !== files[index].size)
    )
      throw new Error('Backup verification failed: the copy does not match the library.');
    return {
      path: destinationRoot,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
    };
  } catch (error) {
    await rm(destinationRoot, { recursive: true, force: true });
    throw error;
  }
}
