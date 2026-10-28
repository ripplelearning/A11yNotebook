import { copyFile, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export interface PasteSourceInfo {
  kind: 'folder' | 'file';
  name: string;
  /** Direct subfolder names, for folders. */
  folders: string[];
  /** Direct file names, for folders. */
  files: string[];
}

interface RelativeFile {
  relative: string;
  size: number;
}

async function walkRelativeFiles(root: string): Promise<RelativeFile[]> {
  const files: RelativeFile[] = [];
  async function walk(relativeDirectory: string): Promise<void> {
    const directory = relativeDirectory ? path.join(root, relativeDirectory) : root;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${relative}`);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) {
        const stat = await lstat(path.join(root, relative));
        files.push({ relative, size: stat.size });
      } else throw new Error(`Unsupported entry in pasted folder: ${relative}`);
    }
  }
  await walk('');
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

/** Describe one OS-copied path: a file, or a folder with its direct children. */
export async function inspectPasteSource(source: string): Promise<PasteSourceInfo> {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links cannot be pasted.');
  const name = path.basename(source);
  if (stat.isFile()) return { kind: 'file', name, folders: [], files: [] };
  if (!stat.isDirectory()) throw new Error('Only files and folders can be pasted.');
  const folders: string[] = [];
  const files: string[] = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links cannot be pasted: ${entry.name}`);
    if (entry.isDirectory()) folders.push(entry.name);
    else if (entry.isFile()) files.push(entry.name);
    else throw new Error(`Unsupported entry in pasted folder: ${entry.name}`);
  }
  return { kind: 'folder', name, folders: folders.sort(), files: files.sort() };
}

/** Find an unused folder name inside parent: base, base-2, base-3, … */
export async function resolveUniqueFolder(parent: string, base: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = path.join(parent, attempt === 0 ? base : `${base}-${attempt + 1}`);
    try {
      await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw error;
    }
  }
  throw new Error('Could not find an unused folder name.');
}

/** Copy a whole folder recursively, verifying file list and sizes, removing a failed copy. */
export async function copyFolder(source: string, destination: string): Promise<{ files: number; bytes: number }> {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (sourceRoot === destinationRoot) throw new Error('Cannot paste a folder into itself.');
  const relative = path.relative(sourceRoot, destinationRoot);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Cannot paste a folder inside itself.');
  }
  try {
    await lstat(destinationRoot);
    throw new Error('The destination folder already exists.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const files = await walkRelativeFiles(sourceRoot);
  try {
    await mkdir(destinationRoot, { recursive: true });
    for (const file of files) {
      const target = path.join(destinationRoot, file.relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(sourceRoot, file.relative), target);
    }
    const copied = await walkRelativeFiles(destinationRoot);
    if (
      copied.length !== files.length ||
      copied.some((entry, index) => entry.relative !== files[index].relative || entry.size !== files[index].size)
    ) {
      throw new Error('Paste verification failed: the copy does not match the source.');
    }
    return { files: files.length, bytes: files.reduce((total, file) => total + file.size, 0) };
  } catch (error) {
    await rm(destinationRoot, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Move a library's direct (orphan) files into notebooks, so the library
 * contains no files outside a notebook. Mode 'one' puts all orphans in a
 * single notebook named notebookName (default "Pasted files"); mode
 * 'per-file' gives each its own notebook named after the file. Returns
 * the notebook names created.
 */
export async function organizeLibraryOrphans(
  libraryPath: string,
  orphanFiles: string[],
  mode: 'one' | 'per-file',
  notebookName?: string,
): Promise<string[]> {
  const created: string[] = [];
  const sanitizeCharacters = (name: string) =>
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .trim()
      .replace(/[. ]+$/, '');
  const sanitize = (name: string) => {
    const stem = name.replace(/\.[^.]*$/, '');
    return sanitizeCharacters(stem) || 'Pasted file';
  };
  // A typed notebook name keeps its text as-is (no extension stripping);
  // illegal characters are replaced and a blank name falls back.
  const sanitizeNotebookName = (name: string) => sanitizeCharacters(name) || 'Pasted files';
  if (mode === 'one') {
    const notebook = await resolveUniqueFolder(libraryPath, sanitizeNotebookName(notebookName ?? 'Pasted files'));
    await mkdir(notebook, { recursive: true });
    for (const file of orphanFiles) {
      await rename(path.join(libraryPath, file), path.join(notebook, file));
    }
    created.push(path.basename(notebook));
  } else {
    for (const file of orphanFiles) {
      const notebook = await resolveUniqueFolder(libraryPath, sanitize(file));
      await mkdir(notebook, { recursive: true });
      await rename(path.join(libraryPath, file), path.join(notebook, file));
      created.push(path.basename(notebook));
    }
  }
  return created;
}
