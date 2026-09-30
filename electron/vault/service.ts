// Filesystem-backed vault operations. This module stays in Electron's main process
// so untrusted renderer content never receives direct filesystem access.
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { VaultBookmark, VaultEntry, VaultInfo, VaultLinkIndex } from '../../src/shared/types';
import { buildVaultLinkIndex } from './links';
import { parseMarkdownTasks } from './tasks';

/** Create an operations facade for one canonical vault folder. */
export function createVaultService(vaultPath: string) {
  let root = '';

  async function initialize(): Promise<VaultInfo> {
    root = await realpath(vaultPath);
    const stat = await lstat(root);
    if (!stat.isDirectory()) throw new Error('Vault must be a folder.');
    await mkdir(path.join(root, '.a11ynotebook'), { recursive: true });
    return getVault();
  }

  async function resolveEntry(relativePath: string, allowMissing = false) {
    if (!root) throw new Error('Open a vault first.');
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === '..' || part === '.' || part === '') ||
      relativePath.split(/[\\/]/)[0].toLowerCase() === '.a11ynotebook'
    ) {
      throw new Error('The requested path is not valid inside this vault.');
    }
    const candidate = path.resolve(root, relativePath);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error('The requested path is outside this vault.');
    }
    const segments = path.relative(root, candidate).split(path.sep);
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported in vault paths.');
        if (index < segments.length - 1 && !stat.isDirectory()) {
          throw new Error('A parent path is not a folder.');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) break;
        throw error;
      }
    }
    return candidate;
  }

  async function scanDirectory(absolutePath: string, relativePath: string): Promise<VaultEntry[]> {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const result: VaultEntry[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.a11ynotebook' || entry.name.startsWith('.')) continue;
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childPath = path.join(absolutePath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: childRelative,
          kind: 'notebook',
          children: await scanDirectory(childPath, childRelative),
        });
      } else if (entry.isFile()) {
        const isNote = path.extname(entry.name).toLowerCase() === '.md';
        result.push({ name: entry.name, path: childRelative, kind: isNote ? 'note' : 'attachment' });
      }
    }
    return result;
  }

  async function getVault(): Promise<VaultInfo> {
    if (!root) throw new Error('Open a vault first.');
    return { name: path.basename(root), path: root, entries: await scanDirectory(root, '') };
  }

  async function readNote(relativePath: string) {
    const target = await resolveEntry(relativePath);
    if (path.extname(target).toLowerCase() !== '.md') throw new Error('Only Markdown notes can be edited.');
    return readFile(target, 'utf8');
  }

  async function saveNote(relativePath: string, content: string) {
    if (typeof content !== 'string') throw new Error('Note content must be text.');
    if (path.extname(relativePath).toLowerCase() !== '.md') throw new Error('Only Markdown notes can be edited.');
    const target = await resolveEntry(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  async function createFolder(relativePath: string) {
    const target = await resolveEntry(relativePath, true);
    await mkdir(target);
    return getVault();
  }

  async function createNote(relativePath: string) {
    const target = await resolveEntry(relativePath, true);
    if (path.extname(target).toLowerCase() !== '.md') throw new Error('Notes must use the .md extension.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `# ${path.basename(target, '.md')}\n\n`, { flag: 'wx' });
    return getVault();
  }

  async function renameEntry(relativePath: string, newName: string) {
    if (!newName || newName === '.' || newName === '..' || /[\\/]/.test(newName)) {
      throw new Error('Enter a valid name without folder separators.');
    }
    const source = await resolveEntry(relativePath);
    const destinationRelative = path.posix.join(path.posix.dirname(relativePath), newName);
    const destination = await resolveEntry(destinationRelative, true);
    try {
      await lstat(destination);
      throw new Error('An item with that name already exists.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const bookmarks = await getBookmarks();
    await rename(source, destination);
    const updatedBookmarks = bookmarks.map((bookmark) =>
      bookmark.path === relativePath || bookmark.path.startsWith(`${relativePath}/`)
        ? {
            ...bookmark,
            path: `${destinationRelative}${bookmark.path.slice(relativePath.length)}`,
            ...(bookmark.path === relativePath && path.extname(relativePath).toLowerCase() === '.md'
              ? { title: path.basename(newName, path.extname(newName)) }
              : {}),
          }
        : bookmark,
    );
    if (updatedBookmarks.some((bookmark, index) => bookmark !== bookmarks[index])) {
      await writeFile(
        path.join(root, '.a11ynotebook', 'bookmarks.json'),
        JSON.stringify(updatedBookmarks, null, 2),
        'utf8',
      );
    }
    return getVault();
  }

  async function getTasks() {
    const notes: string[] = [];
    const collect = (entries: VaultEntry[]) =>
      entries.forEach((entry) => {
        if (entry.kind === 'note') notes.push(entry.path);
        if (entry.children) collect(entry.children);
      });
    collect((await getVault()).entries);
    const taskGroups = await Promise.all(
      notes.map(async (notePath) => parseMarkdownTasks(await readNote(notePath), notePath)),
    );
    return taskGroups.flat();
  }

  async function toggleTask(relativePath: string, lineNumber: number, complete: boolean) {
    const target = await resolveEntry(relativePath);
    if (path.extname(target).toLowerCase() !== '.md' || !Number.isInteger(lineNumber) || lineNumber < 1) {
      throw new Error('Invalid task location.');
    }
    const lines = (await readFile(target, 'utf8')).split(/\r?\n/);
    const index = lineNumber - 1;
    const line = lines[index];
    if (line === undefined || !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      throw new Error('The task no longer exists at this location.');
    }
    lines[index] = line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${complete ? 'x' : ' '}$2`);
    await writeFile(target, lines.join('\n'), 'utf8');
    return getTasks();
  }

  async function getLinkIndex(): Promise<VaultLinkIndex> {
    const notes: Array<{ path: string; content: string }> = [];
    const collect = async (entries: VaultEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === 'note') notes.push({ path: entry.path, content: await readNote(entry.path) });
        if (entry.children) await collect(entry.children);
      }
    };
    const vault = await getVault();
    await collect(vault.entries);
    const index = buildVaultLinkIndex(notes, vault.entries);
    const metadataDirectory = path.join(root, '.a11ynotebook');
    await mkdir(metadataDirectory, { recursive: true });
    await writeFile(path.join(metadataDirectory, 'links.json'), JSON.stringify(index, null, 2), 'utf8');
    return index;
  }

  async function getBookmarks(): Promise<VaultBookmark[]> {
    const bookmarkPath = path.join(root, '.a11ynotebook', 'bookmarks.json');
    try {
      const parsed: unknown = JSON.parse(await readFile(bookmarkPath, 'utf8'));
      const candidates = Array.isArray(parsed)
        ? parsed.filter(
            (item): item is VaultBookmark =>
              typeof item === 'object' &&
              item !== null &&
              typeof (item as VaultBookmark).id === 'string' &&
              typeof (item as VaultBookmark).path === 'string' &&
              typeof (item as VaultBookmark).title === 'string' &&
              typeof (item as VaultBookmark).created === 'string',
          )
        : [];
      const existing = await Promise.all(
        candidates.map(async (bookmark) => {
          try {
            const target = await resolveEntry(bookmark.path);
            return path.extname(target).toLowerCase() === '.md' ? bookmark : null;
          } catch {
            return null;
          }
        }),
      );
      return existing.filter((bookmark): bookmark is VaultBookmark => bookmark !== null);
    } catch {
      return [];
    }
  }

  async function toggleBookmark(relativePath: string) {
    const target = await resolveEntry(relativePath);
    if (path.extname(target).toLowerCase() !== '.md') throw new Error('Only Markdown notes can be bookmarked.');
    const bookmarks = await getBookmarks();
    const next = bookmarks.some((bookmark) => bookmark.path === relativePath)
      ? bookmarks.filter((bookmark) => bookmark.path !== relativePath)
      : [
          ...bookmarks,
          {
            id: relativePath,
            path: relativePath,
            title: path.basename(relativePath, path.extname(relativePath)),
            created: new Date().toISOString(),
          },
        ];
    const metadataDirectory = path.join(root, '.a11ynotebook');
    await mkdir(metadataDirectory, { recursive: true });
    await writeFile(path.join(metadataDirectory, 'bookmarks.json'), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  return {
    initialize,
    getVault,
    readNote,
    saveNote,
    createFolder,
    createNote,
    renameEntry,
    getTasks,
    toggleTask,
    getLinkIndex,
    getBookmarks,
    toggleBookmark,
    resolveEntry,
  };
}
