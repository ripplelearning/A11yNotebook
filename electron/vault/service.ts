// Filesystem-backed vault operations. This module stays in Electron's main process
// so untrusted renderer content never receives direct filesystem access.
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BookmarkAnchor, ReadingPosition, VaultBookmark, VaultEntry, VaultInfo, VaultLinkIndex } from '../../src/shared/types';
import {
  CITATION_SOURCE_TYPES,
  type BibliographyEntry,
} from '../../src/shared/citations';
import { sanitizeBookmarkAnchor } from '../../src/shared/bookmark-anchors';
import type { DocxStructure } from '../../src/shared/docx';
import { parseDocxStructure } from './docx-parser';
import { buildVaultLinkIndex } from './links';
import {
  parseHtmlTasks,
  parseMarkdownTasks,
  toggleHtmlTask,
  updateHtmlTaskDueDate,
  updateHtmlTaskPriority,
  updateHtmlTaskSchedule,
  type TaskSchedule,
} from './tasks';
import type { VaultChangedEvent } from '../../src/shared/search';
import {
  checkedVaultPath,
  createSearchIndex,
  ensureMetadataDirectory,
  type SearchIndexProtectionAdapter,
} from './search';
import { createVaultWatcher } from './watcher';
import { readImport } from './import';
import { createProvenanceStore, type Provenance } from './provenance';
import {
  decryptLibraryFile,
  encryptLibraryFile,
  LIBRARY_CHUNK_SIZE,
  LIBRARY_CONTAINER_MAGIC,
  newLibraryFileId,
} from './library-crypto';
import type { LibraryEncryptionManifest, LibraryManifestFile } from './library-manifest';

/**
 * Bridge for whole-library encryption. The manifest is owned by the
 * caller (ipc persists it as library-encryption.json); the service
 * keeps the working copy and reports every mutation. The content key
 * is supplied lazily so it exists only while the library is unlocked.
 * When a manifest is present, note files are containers on disk and
 * plaintext in memory: reads fail closed for a listed path stored in
 * plaintext or an unlisted container, and every note write encrypts.
 */
export interface VaultLibraryEncryptionAdapter {
  manifest(): LibraryEncryptionManifest | null;
  contentKey(): Buffer | null;
  manifestChanged(manifest: LibraryEncryptionManifest): void;
}

function isNotePath(value: string) {
  return ['.md', '.html', '.htm', '.txt'].includes(path.extname(value).toLowerCase());
}

export class NoteReadSizeLimitError extends Error {
  constructor() {
    super('This note exceeds the safe reading size limit.');
    this.name = 'NoteReadSizeLimitError';
  }
}

function assertVisibleCreationPath(relative: string) {
  if (relative.split(/[\\/]/).some((part) => part.startsWith('.')))
    throw new Error('New library items cannot use hidden names beginning with a dot.');
}

/** Create an operations facade for one canonical vault folder. */
/**
 * Optional bridge to encrypted metadata protection for the two index
 * files this service writes directly. When a file is protected, the
 * service must not touch its plaintext path at all: reads come from
 * the adapter (errors propagate — a tampered protected store fails
 * closed rather than looking empty) and writes go through it.
 */
export interface VaultProtectedMetadataAdapter {
  isProtected(name: 'bookmarks.json' | 'links.json' | 'bibliography.json'): boolean;
  read(name: 'bookmarks.json' | 'links.json' | 'bibliography.json'): Promise<unknown>;
  write(name: 'bookmarks.json' | 'links.json' | 'bibliography.json', value: unknown): Promise<void>;
  /** Optional bridge for the persisted search cache (see search.ts). */
  searchIndex?: SearchIndexProtectionAdapter;
}

export function createVaultService(
  vaultPath: string,
  onChanged?: (event: VaultChangedEvent) => void | Promise<void>,
  protectedMetadata?: VaultProtectedMetadataAdapter,
  libraryEncryption?: VaultLibraryEncryptionAdapter,
) {
  let root = '';
  let searchIndex: ReturnType<typeof createSearchIndex> | undefined;
  let watcher: Awaited<ReturnType<typeof createVaultWatcher>> | undefined;
  let watcherStart: Promise<void> = Promise.resolve();
  let disposed = false;
  let initialization: Promise<VaultInfo> | undefined;
  let noteWrites: Promise<unknown> = Promise.resolve();
  const provenance = createProvenanceStore({ resolveMetadata }, liveProvenanceIdentities);
  let libraryManifest: LibraryEncryptionManifest | null = libraryEncryption?.manifest() ?? null;

  function requireLibraryContentKey(): Buffer {
    const key = libraryEncryption?.contentKey() ?? null;
    if (!key) throw new Error('Unlock the library to use whole-library encryption.');
    return key;
  }

  function isLibraryContainer(bytes: Buffer): boolean {
    return bytes.length >= LIBRARY_CONTAINER_MAGIC.length && bytes.subarray(0, 8).toString('ascii') === LIBRARY_CONTAINER_MAGIC;
  }

  function decodeFileBytes(relativePath: string, bytes: Buffer): Buffer {
    if (!libraryManifest) return bytes;
    const entry = libraryManifest.files[relativePath];
    if (isLibraryContainer(bytes)) {
      if (!entry) throw new Error('This file is encrypted but is not listed in the library encryption manifest.');
      return decryptLibraryFile(requireLibraryContentKey(), entry.fileId, bytes);
    }
    if (entry) throw new Error('This file should be encrypted but is stored in plaintext.');
    return bytes;
  }

  function decodeNoteBytes(relativePath: string, bytes: Buffer): string {
    return decodeFileBytes(relativePath, bytes).toString('utf8');
  }

  function libraryEncryptionCovers(relativePath: string): boolean {
    return Boolean(libraryManifest?.files[relativePath]);
  }

  function decryptSearchBytes(relativePath: string, bytes: Buffer): Buffer | null {
    if (!libraryManifest || !isLibraryContainer(bytes)) return null;
    const entry = libraryManifest.files[relativePath];
    if (!entry) return null;
    const key = libraryEncryption?.contentKey() ?? null;
    if (!key) return null;
    try {
      return decryptLibraryFile(key, entry.fileId, bytes);
    } catch {
      return null;
    }
  }

  function recordManifestEntry(relativePath: string, entry: LibraryManifestFile) {
    if (!libraryManifest) return;
    libraryManifest.files[relativePath] = entry;
    libraryEncryption?.manifestChanged(libraryManifest);
  }

  function fileIdFor(relativePath: string): string {
    return libraryManifest?.files[relativePath]?.fileId ?? newLibraryFileId();
  }

  async function liveProvenanceIdentities() {
    const identities = new Set<string>();
    async function collect(directory: string, prefix = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || (prefix === '' && entry.name.toLowerCase() === '.a11ynotebook')) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        try {
          const absolute = await resolveEntry(relative);
          if (entry.isDirectory()) await collect(absolute, relative);
          else if (entry.isFile()) {
            const identity = await provenance.identity(absolute);
            if (identity) identities.add(identity);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    await collect(root);
    return identities;
  }

  function serializeNoteWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = noteWrites.then(operation);
    noteWrites = result.catch(() => undefined);
    return result;
  }

  function initialize(): Promise<VaultInfo> {
    if (disposed) return Promise.reject(new Error('This library is closed.'));
    if (initialization) return initialization;
    initialization = (async () => {
      root = await realpath(vaultPath);
      const stat = await lstat(root);
      if (!stat.isDirectory()) throw new Error('Library must be a folder.');
      await ensureMetadataDirectory(root);
      searchIndex = createSearchIndex(root, {
        ...(protectedMetadata?.searchIndex ?? {
          isProtected: () => false,
          read: async () => null,
          write: async () => undefined,
        }),
        decryptBytes: (relativePath, bytes) => decryptSearchBytes(relativePath, bytes),
      });
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
    if (!searchIndex || disposed) throw new Error('Open a library first.');
    await searchIndex.refresh();
  }

  async function search(query: unknown) {
    if (!searchIndex || disposed) throw new Error('Open a library first.');
    return searchIndex.search(query);
  }

  async function getTags(): Promise<string[]> {
    if (!searchIndex || disposed) throw new Error('Open a library first.');
    return searchIndex.getTags();
  }

  function startWatcher(
    callback: (event: VaultChangedEvent) => void | Promise<void>,
    onError?: (error: unknown) => void,
  ): Promise<void> {
    if (!searchIndex || disposed) return Promise.reject(new Error('Open a library first.'));
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
    await provenance.flush();
    await searchIndex?.dispose();
    root = '';
  }

  async function resolveMetadata(name: string, allowMissing = false): Promise<string> {
    if (!root || disposed) throw new Error('Open a library first.');
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0:]/.test(name)) {
      throw new Error('Enter a valid metadata filename without folder separators.');
    }
    await ensureMetadataDirectory(root);
    return checkedVaultPath(root, `.a11ynotebook/${name}`, allowMissing);
  }

  async function resolveEntry(relativePath: string, allowMissing = false) {
    if (!root || disposed) throw new Error('Open a library first.');
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      path.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === '..' || part === '.' || part === '') ||
      relativePath.split(/[\\/]/)[0].toLowerCase() === '.a11ynotebook'
    ) {
      throw new Error('The requested path is not valid inside this library.');
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

  async function validateDocxAnnotationDocument(relativePath: string) {
    if (!/\.docx$/i.test(relativePath)) throw new Error('DOCX annotations require a Word document.');
    const absolute = await resolveEntry(relativePath);
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error('Annotations require a document file.');
    // The reader's bounded parser is the structural gate: a file it
    // cannot parse renders no blocks, so no anchor can be created or
    // resolved against it.
    await readDocxStructure(relativePath);
  }

  async function validateEpubAnnotationDocument(relativePath: string) {
    if (!/\.epub$/i.test(relativePath)) throw new Error('ePub annotations require an ePub book.');
    const absolute = await resolveEntry(relativePath);
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error('Annotations require a document file.');
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const header = Buffer.alloc(4);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      // An ePub is a ZIP archive; anything else (including encrypted
      // Office-style containers) cannot be opened by the reader.
      if (bytesRead < 2 || header[0] !== 0x50 || header[1] !== 0x4b)
        throw new Error('Annotations require an unprotected ePub book.');
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
      const bytes = decodeFileBytes(relativePath, await file.readFile());
      if (bytes.length > 40 * 1024 * 1024) throw new Error('This DOCX exceeds the 40 MiB archive limit.');
      const structure = parseDocxStructure(bytes);
      if (disposed || !root) throw new Error('This library is closed.');
      return structure;
    } finally {
      await file.close();
    }
  }

  async function scanDirectory(
    absolutePath: string,
    relativePath: string,
    origins: Awaited<ReturnType<typeof provenance.snapshot>>,
  ): Promise<VaultEntry[]> {
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
          children: await scanDirectory(childPath, childRelative, origins),
        });
      } else if (entry.isFile()) {
        const isNote = isNotePath(entry.name);
        const origin = await provenance.get(childPath, origins);
        result.push({
          name: entry.name,
          path: childRelative,
          kind: isNote ? 'note' : 'attachment',
          ...(origin ? { provenance: origin } : {}),
        });
      }
    }
    return result;
  }

  async function getVault(): Promise<VaultInfo> {
    if (!root || disposed) throw new Error('Open a library first.');
    return {
      name: path.basename(root),
      path: root,
      entries: await scanDirectory(root, '', await provenance.snapshot()),
    };
  }

  async function readNote(relativePath: string, maximumBytes?: number) {
    const target = await resolveEntry(relativePath);
    if (!isNotePath(target)) throw new Error('Only Markdown, HTML, and plain-text notes can be edited.');
    if (maximumBytes === undefined) return decodeNoteBytes(relativePath, await readFile(target));
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Notes must be regular files.');
      // A container is slightly larger than its plaintext; allow the
      // container overhead on top of the plaintext limit and enforce
      // the limit on the decoded text.
      const overhead = libraryManifest
        ? 16 * 1024 + Math.ceil(maximumBytes / LIBRARY_CHUNK_SIZE) * 32
        : 0;
      if (stat.size > maximumBytes + overhead) throw new NoteReadSizeLimitError();
      const bytes = Buffer.alloc(Math.min(stat.size + 1, maximumBytes + overhead + 1));
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maximumBytes + overhead) throw new NoteReadSizeLimitError();
      if (length > stat.size) throw new Error('The note changed while reading. Reopen it.');
      const text = decodeNoteBytes(relativePath, bytes.subarray(0, length));
      if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw new NoteReadSizeLimitError();
      return text;
    } finally {
      await file.close();
    }
  }

  async function replaceNote(
    relativePath: string,
    content: string,
    expectedContent?: string,
    assertCurrent?: () => void,
  ) {
    const target = await resolveEntry(relativePath);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      const stat = await lstat(target);
      let outgoing: string | Buffer = content;
      let manifestEntry: LibraryManifestFile | null = null;
      if (libraryManifest) {
        const fileId = fileIdFor(relativePath);
        const container = encryptLibraryFile(
          requireLibraryContentKey(),
          fileId,
          Buffer.from(content, 'utf8'),
        );
        outgoing = container;
        manifestEntry = {
          fileId,
          plainLength: Buffer.byteLength(content, 'utf8'),
          containerLength: container.length,
        };
      }
      await writeFile(temporary, outgoing, { flag: 'wx', mode: stat.mode & 0o777 });
      await resolveEntry(path.relative(root, temporary));
      await resolveEntry(relativePath);
      if (expectedContent !== undefined && decodeNoteBytes(relativePath, await readFile(target)) !== expectedContent)
        throw new Error('Note changed on disk. Resolve the conflict before saving.');
      const retirePrevious = await preserveProvenance(relativePath, temporary, assertCurrent);
      assertCurrent?.();
      await rename(temporary, target);
      if (manifestEntry) recordManifestEntry(relativePath, manifestEntry);
      await retirePrevious().catch(() => undefined);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  function saveNote(
    relativePath: string,
    content: string,
    expectedContent?: string,
    assertCurrent?: () => void,
  ): Promise<void> {
    return serializeNoteWrite(async () => {
      if (typeof content !== 'string') throw new Error('Note content must be text.');
      if (expectedContent !== undefined && typeof expectedContent !== 'string')
        throw new Error('Expected note content must be text.');
      if (!isNotePath(relativePath)) throw new Error('Only Markdown, HTML, and plain-text notes can be edited.');
      let target: string;
      try {
        target = await resolveEntry(relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        if (expectedContent !== undefined && decodeNoteBytes(relativePath, await readFile(target)) !== expectedContent) {
          throw new Error('Note changed on disk. Resolve the conflict before saving.');
        }
      } catch (error) {
        if (expectedContent !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('Note changed on disk. Resolve the conflict before saving.');
        }
        throw error;
      }
      await replaceNote(relativePath, content, expectedContent, assertCurrent);
      await refreshSearchIndex();
    });
  }

  async function createFolder(relativePath: string) {
    assertVisibleCreationPath(relativePath);
    const target = await resolveEntry(relativePath, true);
    await mkdir(target);
    await refreshSearchIndex();
    return getVault();
  }

  async function preserveProvenance(relativePath: string, staging: string, assertCurrent?: () => void) {
    const original = await resolveEntry(relativePath);
    const previousIdentity = await provenance.identity(original);
    const sharedIdentity = (await lstat(original)).nlink > 1;
    const origin = await provenance.get(original, undefined, true);
    await resolveEntry(path.relative(root, staging));
    if (origin) await provenance.record(staging, origin, assertCurrent);
    return async () => {
      if (sharedIdentity) await provenance.prune(assertCurrent);
      else if (previousIdentity) await provenance.forget([previousIdentity], assertCurrent);
    };
  }

  async function adoptEncryptedNote(relativePath: string, expectedCiphertext: string, assertCurrent: () => void) {
    assertCurrent();
    assertVisibleCreationPath(relativePath);
    const absolute = await resolveEntry(relativePath);
    if (!isNotePath(relativePath)) throw new Error('Only encrypted Markdown and HTML notes can be recovered.');
    const identity = await provenance.identity(absolute);
    if (!identity) throw new Error('This filesystem cannot reliably identify the encrypted note for managed recovery.');
    const adoptedStat = await lstat(absolute);
    if (!adoptedStat.isFile() || adoptedStat.size > 40 * 1024 * 1024)
      throw new Error('The encrypted note changed. Retry recovery.');
    if (decodeNoteBytes(relativePath, await readFile(absolute)) !== expectedCiphertext)
      throw new Error('The encrypted note changed. Retry recovery.');
    assertCurrent();
    await provenance.record(absolute, 'imported', assertCurrent, identity);
    const view = await getVault();
    assertCurrent();
    return view;
  }

  type DocumentCommitted = (absolute: string, identity: { dev: number | bigint; ino: number | bigint }) => void;

  function createDocument(
    relativePath: string,
    content: string | Buffer,
    origin: Provenance,
    assertCurrent: (() => void) | undefined,
    onCommitted: DocumentCommitted | undefined,
    options: { deferRefresh: true },
  ): Promise<void>;
  function createDocument(
    relativePath: string,
    content: string | Buffer,
    origin: Provenance,
    assertCurrent?: () => void,
    onCommitted?: DocumentCommitted,
    options?: { deferRefresh?: false },
  ): Promise<VaultInfo>;
  async function createDocument(
    relativePath: string,
    content: string | Buffer,
    origin: Provenance,
    assertCurrent?: () => void,
    onCommitted?: DocumentCommitted,
    options?: { deferRefresh?: boolean },
  ): Promise<VaultInfo | void> {
    assertCurrent?.();
    assertVisibleCreationPath(relativePath);
    const target = await resolveEntry(relativePath, true);
    let pendingManifestEntry: LibraryManifestFile | null = null;
    if (libraryManifest && Buffer.isBuffer(content)) {
      const fileId = fileIdFor(relativePath);
      const container = encryptLibraryFile(requireLibraryContentKey(), fileId, content);
      pendingManifestEntry = {
        fileId,
        plainLength: content.length,
        containerLength: container.length,
      };
      content = container;
    } else if (libraryManifest && typeof content === 'string') {
      const fileId = fileIdFor(relativePath);
      const container = encryptLibraryFile(requireLibraryContentKey(), fileId, Buffer.from(content, 'utf8'));
      pendingManifestEntry = {
        fileId,
        plainLength: Buffer.byteLength(content, 'utf8'),
        containerLength: container.length,
      };
      content = container;
    }
    const staging = path.join(path.dirname(target), `.import-${randomUUID()}.tmp`);
    let committed = false;
    let stagingKey: string | null = null;
    let targetKey: string | null = null;
    let stagedIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      await writeFile(staging, content, { flag: 'wx', mode: 0o600 });
      stagedIdentity = await lstat(staging);
      stagingKey = await provenance.identity(staging);
      await provenance.record(staging, origin, assertCurrent);
      await resolveEntry(relativePath, true);
      assertCurrent?.();
      // Linking a staged file is atomic and exclusive, unlike rename on POSIX.
      try {
        await link(staging, target);
        committed = true;
        targetKey = stagingKey;
        onCommitted?.(target, stagedIdentity);
      } catch (error) {
        if (
          !['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS', 'EISDIR'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw error;
        // FAT and some network folders cannot hard-link, and Google Drive's
        // virtual filesystem reports EISDIR for the attempt. Exclusive creation
        // still prevents overwrites (an existing directory target fails the
        // exclusive open), and any incomplete file is removed on failure.
        assertCurrent?.();
        const handle = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          stagedIdentity = await handle.stat();
          committed = true;
          onCommitted?.(target, stagedIdentity);
          await handle.writeFile(content);
        } finally {
          await handle.close();
        }
        targetKey = await provenance.identity(target);
        await provenance.record(target, origin, assertCurrent);
      }
      if (options?.deferRefresh) {
        assertCurrent?.();
        return;
      }
      await refreshSearchIndex();
      assertCurrent?.();
      const view = await getVault();
      assertCurrent?.();
      return view;
    } catch (error) {
      if (committed && stagedIdentity) {
        const current = await lstat(target).catch(() => null);
        if (current?.ino === stagedIdentity.ino && current?.dev === stagedIdentity.dev)
          await rm(target, { force: true });
        committed = false;
        await refreshSearchIndex().catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(staging, { force: true }).catch(() => undefined);
      if (committed && pendingManifestEntry) recordManifestEntry(relativePath, pendingManifestEntry);
      const retired = [stagingKey, ...(!committed ? [targetKey] : [])].filter(
        (key): key is string => key !== null && (!committed || key !== targetKey),
      );
      await provenance.forget(retired, assertCurrent).catch(() => undefined);
      if (committed) assertCurrent?.();
    }
  }

  function createNote(
    relativePath: string,
    content?: string,
    origin: Provenance = 'created',
    assertCurrent?: () => void,
    onCommitted?: (absolute: string, identity: { dev: number | bigint; ino: number | bigint }) => void,
  ): Promise<VaultInfo> {
    return serializeNoteWrite(async () => {
      assertCurrent?.();
      if (content !== undefined && typeof content !== 'string') throw new Error('Note content must be text.');
      assertVisibleCreationPath(relativePath);
      const target = await resolveEntry(relativePath, true);
      if (!isNotePath(target)) throw new Error('Notes must use the .md, .html, .htm, or .txt extension.');
      await mkdir(path.dirname(target), { recursive: true });
      const initialContent =
        content ??
        (['.html', '.htm'].includes(path.extname(target).toLowerCase())
          ? `<h1>${path.basename(target, path.extname(target))}</h1>\n<p></p>\n`
          : path.extname(target).toLowerCase() === '.txt'
            ? `${path.basename(target, path.extname(target))}\n\n`
            : `# ${path.basename(target, '.md')}\n\n`);
      return createDocument(relativePath, initialContent, origin, assertCurrent, onCommitted);
    });
  }

  async function createTask(input: unknown, assertCurrent: () => void = () => undefined) {
    if (!input || typeof input !== 'object') throw new Error('Invalid task creation request.');
    const {
      text,
      notebookPath = '',
      due = '',
      reminder = '',
      priority = 'normal',
    } = input as { text?: unknown; notebookPath?: unknown; due?: unknown; reminder?: unknown; priority?: unknown };
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 1000 ||
      [...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      /[\u2028\u2029]/.test(text) ||
      typeof notebookPath !== 'string' ||
      typeof due !== 'string' ||
      (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) ||
      typeof reminder !== 'string' ||
      (reminder && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(reminder)) ||
      !['low', 'normal', 'high', 'urgent'].includes(priority as string)
    )
      throw new Error('Enter a single-line task of 1 to 1000 characters.');
    assertCurrent();
    const notebook = notebookPath ? await resolveEntry(notebookPath) : root;
    if (!(await lstat(notebook)).isDirectory()) throw new Error('Choose a notebook folder.');
    await createNote(
      path.posix.join(notebookPath, `Tasks-${randomUUID()}.md`),
      `- [ ] ${text.trim()}${due ? ` due:${due}` : ''} priority:${priority}${reminder ? ` remind:${reminder}` : ''}\n`,
      'created',
      assertCurrent,
    );
    assertCurrent();
    const tasks = await getTasks();
    assertCurrent();
    return tasks;
  }

  function importFileCopy(
    source: string,
    notebookPath = '',
    assertCurrent: () => void = () => undefined,
    unique = false,
    allowUnsupported = false,
  ) {
    return serializeNoteWrite(async () => {
      assertCurrent();
      const notebook = notebookPath ? await resolveEntry(notebookPath) : root;
      if (!(await lstat(notebook)).isDirectory()) throw new Error('Choose a notebook folder.');
      const imported = await readImport(source, assertCurrent, allowUnsupported);
      const originalName = path.basename(source);
      const originalExtension = path.extname(originalName);
      const filename = originalExtension
        ? originalName.slice(0, -originalExtension.length) + imported.extension
        : originalName;
      const relative = path.posix.join(notebookPath, unique ? `Imported-${randomUUID()}-${filename}` : filename);
      const vault = await createDocument(relative, imported.bytes, 'imported', assertCurrent);
      return { vault, path: relative };
    });
  }

  async function importFile(source: string, notebookPath = '', assertCurrent: () => void = () => undefined) {
    return (await importFileCopy(source, notebookPath, assertCurrent, false, true)).vault;
  }

  async function importEntry(relative: string, assertCurrent: () => void = () => undefined) {
    const source = await resolveEntry(relative);
    return importFileCopy(
      source,
      path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative),
      assertCurrent,
      true,
    );
  }

  async function getProvenance(relative: string) {
    const origin = await provenance.get(await resolveEntry(relative));
    return origin === 'created' ? 'app-created' : (origin ?? 'unknown');
  }

  async function recordProvenance(relative: string, origin: Provenance) {
    await provenance.record(await resolveEntry(relative), origin);
  }

  async function removeProvenance(relative: string) {
    const identities: string[] = [];
    async function collect(selected: string) {
      const absolute = await resolveEntry(selected);
      const stat = await lstat(absolute);
      if (stat.isDirectory()) {
        for (const entry of await readdir(absolute, { withFileTypes: true }))
          if (!entry.isSymbolicLink()) await collect(path.posix.join(selected, entry.name));
      } else {
        const identity = await provenance.identity(absolute);
        if (identity) identities.push(identity);
      }
    }
    await collect(relative);
    await provenance.forget(identities);
  }

  function adoptAuthenticatedNote(relative: string, expectedContent: string, assertCurrent: () => void) {
    return serializeNoteWrite(async () => {
      assertCurrent();
      const target = await resolveEntry(relative);
      const stat = await lstat(target);
      if (await provenance.get(target)) return;
      if ((await readNote(relative, 16 * 1024 * 1024)) !== expectedContent)
        throw new Error('The note changed while authenticating its origin. Reopen it.');
      assertCurrent();
      const identity = await provenance.identity(target);
      const current = await lstat(target);
      if (
        !identity ||
        current.dev !== stat.dev ||
        current.ino !== stat.ino ||
        current.birthtimeMs !== stat.birthtimeMs ||
        current.size !== stat.size ||
        current.mtimeMs !== stat.mtimeMs ||
        current.ctimeMs !== stat.ctimeMs
      )
        throw new Error('The note changed while authenticating its origin. Reopen it.');
      await provenance.record(target, 'created', assertCurrent, identity);
      assertCurrent();
    });
  }

  async function renameEntry(relativePath: string, newName: string) {
    if (typeof newName !== 'string' || !newName || newName === '.' || newName === '..' || /[\\/\0]/.test(newName)) {
      throw new Error('Enter a valid name without folder separators.');
    }
    return moveEntry(relativePath, path.posix.join(path.posix.dirname(relativePath), newName));
  }

  async function moveEntry(relativePath: string, destinationRelative: string): Promise<VaultInfo> {
    assertVisibleCreationPath(destinationRelative);
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
    await rename(source, destination);
    await refreshSearchIndex();
    await migrateMoveMetadata(sourceRelative, nextRelative);
    return getVault();
  }

  async function readBookmarksRaw(): Promise<unknown> {
    if (protectedMetadata?.isProtected('bookmarks.json')) return protectedMetadata.read('bookmarks.json');
    // Resolve outside the try: resolver rejections (symlinked or
    // escaping metadata paths) are security failures and must
    // propagate, not be mistaken for a missing file.
    const bookmarkPath = await resolveMetadata('bookmarks.json', true);
    try {
      return JSON.parse(await readFile(bookmarkPath, 'utf8'));
    } catch {
      return null;
    }
  }

  async function writeBookmarksRaw(value: VaultBookmark[]): Promise<void> {
    if (protectedMetadata?.isProtected('bookmarks.json')) {
      await protectedMetadata.write('bookmarks.json', value);
      return;
    }
    await writeFile(await resolveMetadata('bookmarks.json', true), JSON.stringify(value, null, 2), 'utf8');
  }

  async function readBibliographyRaw(): Promise<unknown> {
    if (protectedMetadata?.isProtected('bibliography.json')) return protectedMetadata.read('bibliography.json');
    const bibliographyPath = await resolveMetadata('bibliography.json', true);
    try {
      return JSON.parse(await readFile(bibliographyPath, 'utf8'));
    } catch {
      return null;
    }
  }

  async function writeBibliographyRaw(value: Record<string, BibliographyEntry[]>): Promise<void> {
    if (protectedMetadata?.isProtected('bibliography.json')) {
      await protectedMetadata.write('bibliography.json', value);
      return;
    }
    await writeFile(await resolveMetadata('bibliography.json', true), JSON.stringify(value, null, 2), 'utf8');
  }

  function cleanBibliographyEntries(value: unknown): BibliographyEntry[] {
    if (!Array.isArray(value)) return [];
    const sourceTypes = new Set(CITATION_SOURCE_TYPES.map((type) => type.id));
    return value.filter((item): item is BibliographyEntry => {
      if (typeof item !== 'object' || item === null) return false;
      const entry = item as BibliographyEntry;
      return (
        typeof entry.id === 'string' &&
        typeof entry.title === 'string' &&
        sourceTypes.has(entry.sourceType) &&
        Array.isArray(entry.authors)
      );
    });
  }

  async function readBibliographyFile(): Promise<Record<string, BibliographyEntry[]>> {
    const parsed: unknown = await readBibliographyRaw();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const notebooks = (parsed as { notebooks?: unknown }).notebooks;
    if (typeof notebooks !== 'object' || notebooks === null || Array.isArray(notebooks)) return {};
    const result: Record<string, BibliographyEntry[]> = {};
    for (const [notebookPath, entries] of Object.entries(notebooks as Record<string, unknown>)) {
      result[notebookPath] = cleanBibliographyEntries(entries);
    }
    return result;
  }

  async function getBibliography(notebookPath: string): Promise<BibliographyEntry[]> {
    const file = await readBibliographyFile();
    return file[notebookPath] ?? [];
  }

  async function saveBibliography(
    notebookPath: string,
    entries: BibliographyEntry[],
  ): Promise<BibliographyEntry[]> {
    const cleaned = cleanBibliographyEntries(entries).map((entry) => ({ ...entry, notebookPath }));
    const file = await readBibliographyFile();
    file[notebookPath] = cleaned;
    await writeBibliographyRaw(file);
    return cleaned;
  }

  /** Idempotent path-prefix migration of bookmarks and reading positions after a move. */
  async function migrateManifestPaths(sourceRelative: string, nextRelative: string) {
    if (!libraryManifest) return;
    let changed = false;
    for (const key of Object.keys(libraryManifest.files)) {
      if (key === sourceRelative || key.startsWith(`${sourceRelative}/`)) {
        libraryManifest.files[`${nextRelative}${key.slice(sourceRelative.length)}`] = libraryManifest.files[key];
        delete libraryManifest.files[key];
        changed = true;
      }
    }
    if (changed) libraryEncryption?.manifestChanged(libraryManifest);
  }

  async function migrateMoveMetadata(sourceRelative: string, nextRelative: string): Promise<void> {
    await migrateManifestPaths(sourceRelative, nextRelative);
    // Read bookmarks.json raw: getBookmarks() drops entries whose files are
    // missing, which after a rename (or a crash mid-move) is exactly the
    // stale source path this migration exists to fix.
    let bookmarks: VaultBookmark[] = [];
    try {
      const parsed: unknown = await readBookmarksRaw();
      if (Array.isArray(parsed)) {
        bookmarks = parsed.filter(
          (item): item is VaultBookmark =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as VaultBookmark).id === 'string' &&
            typeof (item as VaultBookmark).path === 'string' &&
            typeof (item as VaultBookmark).title === 'string' &&
            typeof (item as VaultBookmark).created === 'string',
        );
      }
    } catch {
      bookmarks = [];
    }
    const updatedBookmarks = bookmarks.map((bookmark) =>
      bookmark.path === sourceRelative || bookmark.path.startsWith(`${sourceRelative}/`)
        ? {
            ...bookmark,
            path: `${nextRelative}${bookmark.path.slice(sourceRelative.length)}`,
            ...(bookmark.path === sourceRelative && isNotePath(sourceRelative)
              ? { title: path.posix.basename(nextRelative, path.posix.extname(nextRelative)) }
              : {}),
          }
        : bookmark,
    );
    if (updatedBookmarks.some((bookmark, index) => bookmark !== bookmarks[index])) {
      await writeBookmarksRaw(updatedBookmarks);
    }
    const positions = await readReadingPositions();
    const updatedPositions = positions.map((position) =>
      position.path === sourceRelative || position.path.startsWith(`${sourceRelative}/`)
        ? { ...position, path: `${nextRelative}${position.path.slice(sourceRelative.length)}` }
        : position,
    );
    if (updatedPositions.some((position, index) => position !== positions[index])) {
      await writeReadingPositions(updatedPositions);
    }
    // Bibliography entries are keyed by notebook path, so a notebook move
    // carries its entries along; entries inside a moved notebook follow too.
    const bibliography = await readBibliographyFile();
    let bibliographyChanged = false;
    const movedBibliography: Record<string, BibliographyEntry[]> = {};
    for (const [notebookPath, entries] of Object.entries(bibliography)) {
      if (notebookPath === sourceRelative || notebookPath.startsWith(`${sourceRelative}/`)) {
        const next = `${nextRelative}${notebookPath.slice(sourceRelative.length)}`;
        movedBibliography[next] = entries.map((entry) => ({ ...entry, notebookPath: next }));
        bibliographyChanged = true;
      } else {
        movedBibliography[notebookPath] = entries;
      }
    }
    if (bibliographyChanged) await writeBibliographyRaw(movedBibliography);
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

  function toggleTask(
    relativePath: string,
    taskLocation: string | number,
    complete: boolean,
    revision?: string,
    assertCurrent?: () => void,
  ) {
    return serializeNoteWrite(async () => {
      assertCurrent?.();
      const target = await resolveEntry(relativePath);
      assertCurrent?.();
      const original = decodeNoteBytes(relativePath, await readFile(target));
      assertCurrent?.();
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
        await replaceNote(relativePath, toggleHtmlTask(original, taskLocation, complete), original, assertCurrent);
        assertCurrent?.();
        await refreshSearchIndex();
        assertCurrent?.();
        const tasks = await getTasks();
        assertCurrent?.();
        return tasks;
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
      if (revision !== undefined && createHash('sha256').update(original, 'utf8').digest('hex') !== revision) {
        throw new Error('Note changed on disk. Refresh tasks before toggling.');
      }
      const index = taskLocation - 1;
      const line = lines[index];
      if (line === undefined || !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
        throw new Error('The task no longer exists at this location.');
      }
      lines[index] = line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${complete ? 'x' : ' '}$2`);
      await replaceNote(relativePath, lines.join('\n'), original, assertCurrent);
      assertCurrent?.();
      await refreshSearchIndex();
      assertCurrent?.();
      const tasks = await getTasks();
      assertCurrent?.();
      return tasks;
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
      const original = decodeNoteBytes(relativePath, await readFile(target));
      if (createHash('sha256').update(original, 'utf8').digest('hex') !== revision) {
        throw new Error('Note changed on disk. Refresh tasks before updating this task.');
      }
      await replaceNote(relativePath, updateHtmlTaskDueDate(original, taskId, dueDate), original);
      await refreshSearchIndex();
      return getTasks();
    });
  }

  function setHtmlTaskSchedule(relativePath: string, taskId: string, schedule: TaskSchedule, revision: string) {
    return serializeNoteWrite(async () => {
      const target = await resolveEntry(relativePath);
      if (
        path.extname(target).toLowerCase() !== '.html' ||
        !/^[\w-]{8,80}$/.test(taskId) ||
        !/^[\da-f]{64}$/i.test(revision) ||
        typeof schedule?.dueDate !== 'string' ||
        typeof schedule?.dueTime !== 'string' ||
        typeof schedule?.remindAt !== 'string'
      ) {
        throw new Error('Invalid HTML task schedule request.');
      }
      const original = decodeNoteBytes(relativePath, await readFile(target));
      if (createHash('sha256').update(original, 'utf8').digest('hex') !== revision) {
        throw new Error('Note changed on disk. Refresh tasks before updating this task.');
      }
      await replaceNote(relativePath, updateHtmlTaskSchedule(original, taskId, schedule), original);
      await refreshSearchIndex();
      return getTasks();
    });
  }

  function setHtmlTaskPriority(relativePath: string, taskId: string, priority: string, revision: string) {
    return serializeNoteWrite(async () => {
      const target = await resolveEntry(relativePath);
      if (
        path.extname(target).toLowerCase() !== '.html' ||
        !/^[\w-]{8,80}$/.test(taskId) ||
        !/^[\da-f]{64}$/i.test(revision) ||
        typeof priority !== 'string'
      ) {
        throw new Error('Invalid HTML task priority request.');
      }
      const original = decodeNoteBytes(relativePath, await readFile(target));
      if (createHash('sha256').update(original, 'utf8').digest('hex') !== revision) {
        throw new Error('Note changed on disk. Refresh tasks before updating this task.');
      }
      await replaceNote(relativePath, updateHtmlTaskPriority(original, taskId, priority), original);
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
    if (protectedMetadata?.isProtected('links.json')) await protectedMetadata.write('links.json', index);
    else await writeFile(await resolveMetadata('links.json', true), JSON.stringify(index, null, 2), 'utf8');
    return index;
  }

  async function getBookmarks(): Promise<VaultBookmark[]> {
    // Protected reads fail closed: a tampered protected store throws
    // here instead of being mistaken for an empty bookmark list that
    // a later toggle would then write back over the real data.
    const parsed: unknown = await readBookmarksRaw();
    try {
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
            if (!isNotePath(target) && path.extname(target).toLowerCase() !== '.docx') return null;
            const anchor = sanitizeBookmarkAnchor(bookmark.anchor);
            const clean: VaultBookmark = {
              id: bookmark.id,
              path: bookmark.path,
              title: bookmark.title,
              created: bookmark.created,
            };
            if (anchor) clean.anchor = anchor;
            return clean;
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
    await writeBookmarksRaw(next);
    return next;
  }

  /** Add a bookmark, optionally anchored to a heading or character position. Idempotent per path+anchor. */
  async function addBookmark(relativePath: string, anchor?: BookmarkAnchor) {
    const target = await resolveEntry(relativePath);
    if (!isNotePath(target) && path.extname(target).toLowerCase() !== '.docx') {
      throw new Error('Only notes and DOCX documents can be bookmarked.');
    }
    const cleanAnchor = sanitizeBookmarkAnchor(anchor);
    const bookmarks = await getBookmarks();
    const duplicate = bookmarks.some(
      (bookmark) =>
        bookmark.path === relativePath &&
        JSON.stringify(bookmark.anchor ?? null) === JSON.stringify(cleanAnchor ?? null),
    );
    if (duplicate) return bookmarks;
    const next = [
      ...bookmarks,
      {
        id: randomUUID(),
        path: relativePath,
        title:
          cleanAnchor?.kind === 'heading'
            ? cleanAnchor.text
            : path.basename(relativePath, path.extname(relativePath)),
        created: new Date().toISOString(),
        ...(cleanAnchor ? { anchor: cleanAnchor } : {}),
      },
    ];
    await writeBookmarksRaw(next);
    return next;
  }

  async function removeBookmark(id: string) {
    const bookmarks = await getBookmarks();
    const next = bookmarks.filter((bookmark) => bookmark.id !== id);
    if (next.length !== bookmarks.length) {
      await writeBookmarksRaw(next);
    }
    return next;
  }

  async function readReadingPositions(): Promise<ReadingPosition[]> {
    const filePath = await resolveMetadata('reading-positions.json', true);
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is ReadingPosition =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as ReadingPosition).path === 'string' &&
          typeof (item as ReadingPosition).cfi === 'string' &&
          Number.isInteger((item as ReadingPosition).sectionIndex) &&
          typeof (item as ReadingPosition).updated === 'string',
      );
    } catch {
      return [];
    }
  }

  async function writeReadingPositions(positions: ReadingPosition[]): Promise<void> {
    await writeFile(await resolveMetadata('reading-positions.json', true), JSON.stringify(positions, null, 2), 'utf8');
  }

  async function getReadingPosition(relativePath: string): Promise<ReadingPosition | null> {
    try {
      await resolveEntry(relativePath);
    } catch {
      return null; // A book deleted outside the app simply has no position.
    }
    const positions = await readReadingPositions();
    return positions.find((position) => position.path === relativePath) ?? null;
  }

  async function setReadingPosition(
    relativePath: string,
    position: { cfi: unknown; sectionIndex: unknown },
  ): Promise<void> {
    const target = await resolveEntry(relativePath);
    if (path.extname(target).toLowerCase() !== '.epub') {
      throw new Error('Reading positions are saved for ePub documents.');
    }
    if (
      typeof position?.cfi !== 'string' ||
      position.cfi.length > 4096 ||
      (position.cfi !== '' && !position.cfi.startsWith('epubcfi('))
    ) {
      throw new Error('The reading position is invalid.');
    }
    if (
      !Number.isInteger(position.sectionIndex) ||
      (position.sectionIndex as number) < 0 ||
      (position.sectionIndex as number) > 100_000
    ) {
      throw new Error('The reading position is invalid.');
    }
    const positions = await readReadingPositions();
    const retained = positions.filter((entry) => entry.path !== relativePath);
    retained.push({
      path: relativePath,
      cfi: position.cfi,
      sectionIndex: position.sectionIndex as number,
      updated: new Date().toISOString(),
    });
    retained.sort((a, b) => a.updated.localeCompare(b.updated));
    await writeReadingPositions(retained.slice(-500));
  }

  function setLibraryManifest(manifest: LibraryEncryptionManifest | null) {
    libraryManifest = manifest;
  }

  function libraryEncryptionManifest(): LibraryEncryptionManifest | null {
    return libraryManifest;
  }

  /**
   * Convert every note file to a container, resumably: files already
   * containerized and listed are verified and skipped, the manifest
   * is reported after each file so a crash mid-migration resumes
   * from the persisted state, manifest entries for missing files
   * are pruned, and the state flips to 'active' only at the end.
   * Any inconsistency (unlisted container, listed plaintext) stops
   * the migration loudly instead of guessing.
   */
  async function migrateToLibraryEncryption(assertCurrent: () => void = () => undefined): Promise<void> {
    if (!libraryManifest) throw new Error('Whole-library encryption is not enabled for this library.');
    const key = requireLibraryContentKey();
    const info = await getVault();
    const files: string[] = [];
    const collect = (entries: VaultEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === 'note' || entry.kind === 'attachment') files.push(entry.path);
        if (entry.children) collect(entry.children);
      }
    };
    collect(info.entries);
    const present = new Set(files);
    let pruned = false;
    for (const listed of Object.keys(libraryManifest.files)) {
      if (!present.has(listed)) {
        delete libraryManifest.files[listed];
        pruned = true;
      }
    }
    if (pruned) libraryEncryption?.manifestChanged(libraryManifest);
    for (const relative of files) {
      assertCurrent();
      const target = await resolveEntry(relative);
      const raw = await readFile(target);
      const existing = libraryManifest.files[relative];
      if (isLibraryContainer(raw)) {
        if (!existing)
          throw new Error(`The file ${relative} is an encryption container but is not in the manifest.`);
        const plain = decryptLibraryFile(key, existing.fileId, raw);
        recordManifestEntry(relative, {
          fileId: existing.fileId,
          plainLength: plain.length,
          containerLength: raw.length,
        });
        continue;
      }
      if (existing) throw new Error(`The file ${relative} should be encrypted but is stored in plaintext.`);
      const fileId = newLibraryFileId();
      const container = encryptLibraryFile(key, fileId, raw);
      await rewriteRawBytes(relative, container, assertCurrent);
      recordManifestEntry(relative, {
        fileId,
        plainLength: raw.length,
        containerLength: container.length,
      });
    }
    if (libraryManifest.state !== 'active') {
      libraryManifest.state = 'active';
      libraryEncryption?.manifestChanged(libraryManifest);
    }
    await refreshSearchIndex();
  }

  /** Atomically replace a file's raw bytes (provenance-preserving). */
  async function rewriteRawBytes(relativePath: string, bytes: Buffer, assertCurrent?: () => void) {
    const target = await resolveEntry(relativePath);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      const stat = await lstat(target);
      await writeFile(temporary, bytes, { flag: 'wx', mode: stat.mode & 0o777 });
      await resolveEntry(path.relative(root, temporary));
      await resolveEntry(relativePath);
      const retirePrevious = await preserveProvenance(relativePath, temporary, assertCurrent);
      assertCurrent?.();
      await rename(temporary, target);
      await retirePrevious().catch(() => undefined);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Reverse migration for turning whole-library encryption off:
   * decrypt every listed note back to an ordinary file, removing
   * its manifest entry as it converts so an interruption resumes
   * cleanly (already-plaintext listed files just lose their entry;
   * missing files are pruned). The caller owns the manifest's
   * 'decrypting' state and deletes the manifest file afterwards;
   * when this resolves, the manifest's file map is empty.
   */
  async function migrateFromLibraryEncryption(assertCurrent: () => void = () => undefined): Promise<void> {
    if (!libraryManifest) throw new Error('Whole-library encryption is not enabled for this library.');
    const key = requireLibraryContentKey();
    for (const relative of Object.keys(libraryManifest.files)) {
      assertCurrent();
      const entry = libraryManifest.files[relative];
      if (!entry) continue;
      const target = await resolveEntry(relative).catch(() => null);
      if (target) {
        const raw = await readFile(target);
        if (isLibraryContainer(raw)) {
          const plain = decryptLibraryFile(key, entry.fileId, raw);
          await rewriteRawBytes(relative, plain, assertCurrent);
        } else if (libraryManifest.state !== 'decrypting') {
          throw new Error(`The file ${relative} should be encrypted but is stored in plaintext.`);
        }
      }
      delete libraryManifest.files[relative];
      libraryEncryption?.manifestChanged(libraryManifest);
    }
    await refreshSearchIndex();
  }

  return {
    initialize,
    getVault,
    readNote,
    setLibraryManifest,
    libraryEncryptionManifest,
    migrateToLibraryEncryption,
    migrateFromLibraryEncryption,
    decodeFileBytes,
    libraryEncryptionCovers,
    // The asset store's save path: same staging, baseline and
    // encryption behavior as replaceNote, without the note-path
    // restriction (assets include .csv and .json sources).
    replaceTextFile: replaceNote,
    saveNote,
    createFolder,
    createNote,
    createTask,
    importFile,
    importEntry,
    getProvenance,
    recordProvenance,
    removeProvenance,
    adoptAuthenticatedNote,
    createDocument,
    preserveProvenance,
    adoptEncryptedNote,
    pruneProvenance: (assertCurrent?: () => void) => provenance.prune(assertCurrent),
    renameEntry,
    moveEntry,
    migrateMoveMetadata,
    getTasks,
    toggleTask,
    setHtmlTaskDueDate,
    setHtmlTaskSchedule,
    setHtmlTaskPriority,
    getLinkIndex,
    getBookmarks,
    toggleBookmark,
    addBookmark,
    removeBookmark,
    getBibliography,
    saveBibliography,
    getReadingPosition,
    setReadingPosition,
    resolveEntry,
    validatePdfAnnotationDocument,
    validateDocxAnnotationDocument,
    validateEpubAnnotationDocument,
    readDocxStructure,
    resolveMetadata,
    search,
    getTags,
    refreshSearchIndex,
    startWatcher,
    dispose,
  };
}
