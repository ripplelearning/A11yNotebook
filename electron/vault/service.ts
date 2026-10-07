// Filesystem-backed vault operations. This module stays in Electron's main process
// so untrusted renderer content never receives direct filesystem access.
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { VaultBookmark, VaultEntry, VaultInfo, VaultLinkIndex } from '../../src/shared/types';
import type { DocxStructure } from '../../src/shared/docx';
import { parseDocxStructure } from './docx-parser';
import { buildVaultLinkIndex } from './links';
import { parseHtmlTasks, parseMarkdownTasks, toggleHtmlTask, updateHtmlTaskDueDate } from './tasks';
import type { VaultChangedEvent } from '../../src/shared/search';
import { checkedVaultPath, createSearchIndex, ensureMetadataDirectory } from './search';
import { createVaultWatcher } from './watcher';

function isNotePath(value: string) {
  return ['.md', '.html'].includes(path.extname(value).toLowerCase());
}

/** Create an operations facade for one canonical vault folder. */
export function createVaultService(vaultPath: string, onChanged?: (event: VaultChangedEvent) => void | Promise<void>) {
  let root = '';
  let searchIndex: ReturnType<typeof createSearchIndex> | undefined;
  let watcher: Awaited<ReturnType<typeof createVaultWatcher>> | undefined;
  let watcherStart: Promise<void> = Promise.resolve();
  let disposed = false;
  let initialization: Promise<VaultInfo> | undefined;
  let noteWrites: Promise<unknown> = Promise.resolve();

  function serializeNoteWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = noteWrites.then(operation);
    noteWrites = result.catch(() => undefined);
    return result;
  }

  function initialize(): Promise<VaultInfo> {
    if (disposed) return Promise.reject(new Error('This vault is closed.'));
    if (initialization) return initialization;
    initialization = (async () => {
      root = await realpath(vaultPath);
      const stat = await lstat(root);
      if (!stat.isDirectory()) throw new Error('Vault must be a folder.');
      await ensureMetadataDirectory(root);
      searchIndex = createSearchIndex(root);
      await searchIndex.initialize();
      if (onChanged) await startWatcher(onChanged);
      return getVault();
    })().catch(async (error: unknown) => {
      await watcher?.dispose();
      await searchIndex?.dispose();
      searchIndex = undefined;
      root = '';
      initialization = undefined;
      throw error;
    });
    return initialization;
  }

  async function refreshSearchIndex() {
    if (!searchIndex || disposed) throw new Error('Open a vault first.');
    await searchIndex.refresh();
  }

  async function search(query: unknown) {
    if (!searchIndex || disposed) throw new Error('Open a vault first.');
    return searchIndex.search(query);
  }

  async function getTags(): Promise<string[]> {
    if (!searchIndex || disposed) throw new Error('Open a vault first.');
    return searchIndex.getTags();
  }

  function startWatcher(
    callback: (event: VaultChangedEvent) => void | Promise<void>,
    onError?: (error: unknown) => void,
  ): Promise<void> {
    if (!searchIndex || disposed) return Promise.reject(new Error('Open a vault first.'));
    if (typeof callback !== 'function') return Promise.reject(new Error('A change callback is required.'));
    if (onError !== undefined && typeof onError !== 'function')
      return Promise.reject(new Error('Invalid watcher error callback.'));
    const next = watcherStart.then(async () => {
      if (disposed) return;
      await watcher?.dispose();
      watcher = await createVaultWatcher(
        root,
        async (event) => {
          await refreshSearchIndex();
          if (!disposed) await callback(event);
        },
        { onError },
      );
    });
    watcherStart = next.catch(() => undefined);
    return next;
  }

  async function dispose() {
    disposed = true;
    await initialization?.catch(() => undefined);
    await watcherStart;
    await watcher?.dispose();
    await noteWrites;
    await searchIndex?.dispose();
    root = '';
  }

  async function resolveMetadata(name: string, allowMissing = false): Promise<string> {
    if (!root || disposed) throw new Error('Open a vault first.');
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0:]/.test(name)) {
      throw new Error('Enter a valid metadata filename without folder separators.');
    }
    await ensureMetadataDirectory(root);
    return checkedVaultPath(root, `.a11ynotebook/${name}`, allowMissing);
  }

  async function resolveEntry(relativePath: string, allowMissing = false) {
    if (!root || disposed) throw new Error('Open a vault first.');
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      path.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === '..' || part === '.' || part === '') ||
      relativePath.split(/[\\/]/)[0].toLowerCase() === '.a11ynotebook'
    ) {
      throw new Error('The requested path is not valid inside this vault.');
    }
    return checkedVaultPath(root, relativePath, allowMissing);
  }

  async function validatePdfAnnotationDocument(relativePath: string) {
    if (!/\.pdf$/i.test(relativePath)) throw new Error('PDF annotations require a PDF document.');
    const absolute = await resolveEntry(relativePath);
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error('Annotations require a document file.');
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedStat = await file.stat();
      if (!openedStat.isFile()) throw new Error('Annotations require a document file.');
      if (/\.pdf$/i.test(relativePath)) {
        const header = Buffer.alloc(1024);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (!header.subarray(0, bytesRead).includes(Buffer.from('%PDF-')))
          throw new Error('Annotations require an unprotected PDF document.');
        if (openedStat.size > 40 * 1024 * 1024) throw new Error('This PDF is too large to annotate.');
        const bytes = await file.readFile();
        if (bytes.length > 40 * 1024 * 1024) throw new Error('This PDF is too large to annotate.');
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = getDocument({
          data: new Uint8Array(bytes),
          useSystemFonts: false,
          enableXfa: false,
          verbosity: 0,
        });
        try {
          const document = await loadingTask.promise;
          if ((await document.getPermissions()) !== null)
            throw new Error('Annotations are unavailable for protected content.');
        } catch (error) {
          if (error instanceof Error && error.name === 'PasswordException')
            throw new Error('Annotations are unavailable for protected content.');
          throw error;
        } finally {
          await loadingTask.destroy();
        }

        return;
      }
    } finally {
      await file.close();
    }
  }

  async function readDocxStructure(relativePath: string): Promise<DocxStructure> {
    if (!/\.docx$/i.test(relativePath)) throw new Error('DOCX reading requires a .docx document.');
    const absolute = await resolveEntry(relativePath);
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 40 * 1024 * 1024) {
        throw new Error('This DOCX exceeds the 40 MiB archive limit.');
      }
      const bytes = await file.readFile();
      if (bytes.length > 40 * 1024 * 1024) throw new Error('This DOCX exceeds the 40 MiB archive limit.');
      const structure = parseDocxStructure(bytes);
      if (disposed || !root) throw new Error('This vault is closed.');
      return structure;
    } finally {
      await file.close();
    }
  }

  async function scanDirectory(absolutePath: string, relativePath: string): Promise<VaultEntry[]> {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const result: VaultEntry[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.a11ynotebook' || entry.name.startsWith('.')) continue;
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      const childPath = await resolveEntry(childRelative);
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: childRelative,
          kind: 'notebook',
          children: await scanDirectory(childPath, childRelative),
        });
      } else if (entry.isFile()) {
        const isNote = isNotePath(entry.name);
        result.push({ name: entry.name, path: childRelative, kind: isNote ? 'note' : 'attachment' });
      }
    }
    return result;
  }

  async function getVault(): Promise<VaultInfo> {
    if (!root || disposed) throw new Error('Open a vault first.');
    return { name: path.basename(root), path: root, entries: await scanDirectory(root, '') };
  }

  async function readNote(relativePath: string) {
    const target = await resolveEntry(relativePath);
    if (!isNotePath(target)) throw new Error('Only Markdown and HTML notes can be edited.');
    return readFile(target, 'utf8');
  }

  async function replaceNote(relativePath: string, content: string, expectedContent?: string) {
    const target = await resolveEntry(relativePath);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      const stat = await lstat(target);
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: stat.mode & 0o777 });
      await resolveEntry(path.relative(root, temporary));
      await resolveEntry(relativePath);
      if (expectedContent !== undefined && (await readFile(target, 'utf8')) !== expectedContent)
        throw new Error('Note changed on disk. Resolve the conflict before saving.');
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  function saveNote(relativePath: string, content: string, expectedContent?: string): Promise<void> {
    return serializeNoteWrite(async () => {
      if (typeof content !== 'string') throw new Error('Note content must be text.');
      if (expectedContent !== undefined && typeof expectedContent !== 'string')
        throw new Error('Expected note content must be text.');
      if (!isNotePath(relativePath)) throw new Error('Only Markdown and HTML notes can be edited.');
      let target: string;
      try {
        target = await resolveEntry(relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        if (expectedContent !== undefined && (await readFile(target, 'utf8')) !== expectedContent) {
          throw new Error('Note changed on disk. Resolve the conflict before saving.');
        }
      } catch (error) {
        if (expectedContent !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('Note changed on disk. Resolve the conflict before saving.');
        }
        throw error;
      }
      await replaceNote(relativePath, content, expectedContent);
      await refreshSearchIndex();
    });
  }

  async function createFolder(relativePath: string) {
    const target = await resolveEntry(relativePath, true);
    await mkdir(target);
    await refreshSearchIndex();
    return getVault();
  }

  function createNote(relativePath: string, content?: string): Promise<VaultInfo> {
    return serializeNoteWrite(async () => {
      if (content !== undefined && typeof content !== 'string') throw new Error('Note content must be text.');
      const target = await resolveEntry(relativePath, true);
      if (!isNotePath(target)) throw new Error('Notes must use the .md or .html extension.');
      await mkdir(path.dirname(target), { recursive: true });
      const initialContent =
        content ??
        (path.extname(target).toLowerCase() === '.html'
          ? `<h1>${path.basename(target, path.extname(target))}</h1>\n<p></p>\n`
          : `# ${path.basename(target, '.md')}\n\n`);
      await writeFile(target, initialContent, { flag: 'wx' });
      await refreshSearchIndex();
      return getVault();
    });
  }

  async function renameEntry(relativePath: string, newName: string) {
    if (typeof newName !== 'string' || !newName || newName === '.' || newName === '..' || /[\\/\0]/.test(newName)) {
      throw new Error('Enter a valid name without folder separators.');
    }
    return moveEntry(relativePath, path.posix.join(path.posix.dirname(relativePath), newName));
  }

  async function moveEntry(relativePath: string, destinationRelative: string): Promise<VaultInfo> {
    const source = await resolveEntry(relativePath);
    const destination = await resolveEntry(destinationRelative, true);
    if (destination.startsWith(`${source}${path.sep}`)) throw new Error('An item cannot be moved inside itself.');
    const parent = await lstat(path.dirname(destination));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('The destination notebook must be a folder.');
    try {
      await lstat(destination);
      throw new Error('An item with that name already exists.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const sourceRelative = path.relative(root, source).split(path.sep).join('/');
    const nextRelative = path.relative(root, destination).split(path.sep).join('/');
    const newName = path.basename(destination);
    const bookmarks = await getBookmarks();
    await rename(source, destination);
    await refreshSearchIndex();
    const updatedBookmarks = bookmarks.map((bookmark) =>
      bookmark.path === sourceRelative || bookmark.path.startsWith(`${sourceRelative}/`)
        ? {
            ...bookmark,
            path: `${nextRelative}${bookmark.path.slice(sourceRelative.length)}`,
            ...(bookmark.path === sourceRelative && isNotePath(sourceRelative)
              ? { title: path.basename(newName, path.extname(newName)) }
              : {}),
          }
        : bookmark,
    );
    if (updatedBookmarks.some((bookmark, index) => bookmark !== bookmarks[index])) {
      await writeFile(await resolveMetadata('bookmarks.json', true), JSON.stringify(updatedBookmarks, null, 2), 'utf8');
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
      notes.map(async (notePath) => {
        const content = await readNote(notePath);
        return path.extname(notePath).toLowerCase() === '.html'
          ? parseHtmlTasks(content, notePath)
          : parseMarkdownTasks(content, notePath);
      }),
    );
    return taskGroups.flat();
  }

  function toggleTask(relativePath: string, taskLocation: string | number, complete: boolean, revision?: string) {
    return serializeNoteWrite(async () => {
      const target = await resolveEntry(relativePath);
      const original = await readFile(target, 'utf8');
      if (path.extname(target).toLowerCase() === '.html') {
        if (
          typeof taskLocation !== 'string' ||
          !/^[\w-]{8,80}$/.test(taskLocation) ||
          !/^[\da-f]{64}$/i.test(revision ?? '')
        ) {
          throw new Error('Invalid HTML task update request.');
        }

        const currentRevision = createHash('sha256').update(original, 'utf8').digest('hex');
        if (currentRevision !== revision) throw new Error('Note changed on disk. Refresh tasks before toggling.');
        await replaceNote(relativePath, toggleHtmlTask(original, taskLocation, complete), original);
        await refreshSearchIndex();
        return getTasks();
      }
      if (
        path.extname(target).toLowerCase() !== '.md' ||
        typeof taskLocation !== 'number' ||
        !Number.isInteger(taskLocation) ||
        taskLocation < 1
      ) {
        throw new Error('Invalid task location.');
      }
      const lines = original.split(/\r?\n/);
      const index = taskLocation - 1;
      const line = lines[index];
      if (line === undefined || !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
        throw new Error('The task no longer exists at this location.');
      }
      lines[index] = line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${complete ? 'x' : ' '}$2`);
      await replaceNote(relativePath, lines.join('\n'), original);
      await refreshSearchIndex();
      return getTasks();
    });
  }

  function setHtmlTaskDueDate(relativePath: string, taskId: string, dueDate: string, revision: string) {
    return serializeNoteWrite(async () => {
      const target = await resolveEntry(relativePath);
      if (
        path.extname(target).toLowerCase() !== '.html' ||
        !/^[\w-]{8,80}$/.test(taskId) ||
        !/^[\da-f]{64}$/i.test(revision)
      ) {
        throw new Error('Invalid HTML task update request.');
      }
      const original = await readFile(target, 'utf8');
      if (createHash('sha256').update(original, 'utf8').digest('hex') !== revision) {
        throw new Error('Note changed on disk. Refresh tasks before updating this task.');
      }
      await replaceNote(relativePath, updateHtmlTaskDueDate(original, taskId, dueDate), original);
      await refreshSearchIndex();
      return getTasks();
    });
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
    await writeFile(await resolveMetadata('links.json', true), JSON.stringify(index, null, 2), 'utf8');
    return index;
  }

  async function getBookmarks(): Promise<VaultBookmark[]> {
    const bookmarkPath = await resolveMetadata('bookmarks.json', true);
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
            return isNotePath(target) || path.extname(target).toLowerCase() === '.docx' ? bookmark : null;
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
    if (!isNotePath(target) && path.extname(target).toLowerCase() !== '.docx') {
      throw new Error('Only notes and DOCX documents can be bookmarked.');
    }
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
    await writeFile(await resolveMetadata('bookmarks.json', true), JSON.stringify(next, null, 2), 'utf8');
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
    moveEntry,
    getTasks,
    toggleTask,
    setHtmlTaskDueDate,
    getLinkIndex,
    getBookmarks,
    toggleBookmark,
    resolveEntry,
    validatePdfAnnotationDocument,
    readDocxStructure,
    resolveMetadata,
    search,
    getTags,
    refreshSearchIndex,
    startWatcher,
    dispose,
  };
}
