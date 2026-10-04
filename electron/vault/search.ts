import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { VaultSearchQuery, VaultSearchResult } from '../../src/shared/search';
import { extractEpubPages, extractPdfPages } from './document-preview';

const VERSION = 3;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_INDEXED_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.html', '.htm']);

interface IndexedDocument {
  path: string;
  title: string;
  kind: 'note' | 'attachment';
  notebook: string;
  tags: string[];
  text: string;
  size: number;
  mtime: number;
  ctime: number;
  ino: number;
}

export function isVisibleVaultPath(relativePath: string) {
  return (
    !path.isAbsolute(relativePath) &&
    !path.win32.isAbsolute(relativePath) &&
    !relativePath.includes('\\') &&
    relativePath.split('/').every((segment) => segment !== '' && !segment.startsWith('.'))
  );
}

/** Check every ancestor, including the private metadata folder, before accessing it. */
export async function checkedVaultPath(root: string, relativePath: string, allowMissing = false) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Vault root must remain a regular folder.');
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('The requested path is not valid inside this vault.');
  }
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Path is outside the vault.');
  let current = root;
  const segments = path.relative(root, target).split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported in vault paths.');
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error('A parent path is not a folder.');
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

export async function ensureMetadataDirectory(root: string) {
  const directory = await checkedVaultPath(root, '.a11ynotebook', true);
  await mkdir(directory, { recursive: true });
  await checkedVaultPath(root, '.a11ynotebook');
  if (!(await lstat(directory)).isDirectory()) throw new Error('Vault metadata must be a folder.');
  return directory;
}

async function readSafeText(root: string, relativePath: string, maximum: number) {
  const target = await checkedVaultPath(root, relativePath);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) return null;
    const content = await file.readFile('utf8');
    if (Buffer.byteLength(content) > maximum || content.includes('\0')) return null;
    return { content, stat };
  } finally {
    await file.close();
  }
}

async function readSafeBuffer(root: string, relativePath: string, maximum: number) {
  const target = await checkedVaultPath(root, relativePath);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) return null;
    const content = await file.readFile();
    if (content.length > maximum) return null;
    return { content, stat };
  } finally {
    await file.close();
  }
}

function extractDocumentText(content: Buffer, extension: string) {
  try {
    const pages = extension === '.pdf' ? extractPdfPages(content) : extractEpubPages(content);
    return pages.join('\n\n').slice(0, MAX_FILE_BYTES);
  } catch {
    return '';
  }
}

function extractText(content: string, extension: string) {
  if (extension === '.html' || extension === '.htm') {
    return content
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (entity) => {
        const entities: Record<string, string> = {
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&nbsp;': ' ',
        };
        return entities[entity.toLowerCase()];
      })
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) => {
        const point = value.startsWith('x') || value.startsWith('X') ? parseInt(value.slice(1), 16) : Number(value);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
      })
      .replace(/\s+/g, ' ')
      .trim();
  }
  return content.replace(/\s+/g, ' ').trim();
}

function extractTags(content: string) {
  const tags = new Set<string>();
  for (const match of content.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.add(match[1].toLowerCase());
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const tagLine = frontmatter?.match(/^tags:[ \t]*([^\r\n]*)/m)?.[1];
  const block = frontmatter?.match(/^tags:[ \t]*\r?\n((?:[ \t]+-[ \t]+[^\r\n]+\r?\n?)+)/m)?.[1];
  const candidates = tagLine?.trim()
    ? tagLine.replace(/^\[|\]$/g, '').split(',')
    : (block?.split(/\r?\n/).map((line) => line.replace(/^[ \t]+-[ \t]+/, '')) ?? []);
  if (candidates.length) {
    for (const tag of candidates) {
      const clean = tag
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/^#/, '')
        .toLowerCase();
      if (clean) tags.add(clean);
    }
  }
  return [...tags].sort();
}

export function validateSearchQuery(value: unknown): VaultSearchQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid search query.');
  const query = value as VaultSearchQuery;
  if (typeof query.text !== 'string' || query.text.length > 1000)
    throw new Error('Search text must be at most 1000 characters.');
  if (
    query.notebook !== undefined &&
    (typeof query.notebook !== 'string' ||
      query.notebook.length > 512 ||
      (query.notebook !== '' && !isVisibleVaultPath(query.notebook)))
  )
    throw new Error('Invalid notebook filter.');
  if (query.kind !== undefined && query.kind !== 'note' && query.kind !== 'attachment')
    throw new Error('Invalid kind filter.');
  if (query.tag !== undefined && (typeof query.tag !== 'string' || !query.tag.trim() || query.tag.length > 100))
    throw new Error('Invalid tag filter.');
  for (const date of [query.modifiedAfter, query.modifiedBefore]) {
    if (
      date !== undefined &&
      (typeof date !== 'string' ||
        date.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) ||
        !Number.isFinite(Date.parse(date)))
    ) {
      throw new Error('Invalid modified date filter.');
    }
  }
  if (query.modifiedAfter && query.modifiedBefore && Date.parse(query.modifiedAfter) > Date.parse(query.modifiedBefore))
    throw new Error('Modified date range is reversed.');
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200))
    throw new Error('Search limit must be between 1 and 200.');
  return { ...query };
}

function validCachedDocument(value: unknown): value is IndexedDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as IndexedDocument;
  return (
    typeof doc.path === 'string' &&
    isVisibleVaultPath(doc.path) &&
    typeof doc.title === 'string' &&
    doc.title.length <= 1000 &&
    (doc.kind === 'note' || doc.kind === 'attachment') &&
    typeof doc.notebook === 'string' &&
    typeof doc.text === 'string' &&
    doc.text.length <= MAX_FILE_BYTES &&
    Array.isArray(doc.tags) &&
    doc.tags.length <= 10000 &&
    doc.tags.every((tag) => typeof tag === 'string' && tag.length <= MAX_FILE_BYTES) &&
    [doc.size, doc.mtime, doc.ctime, doc.ino].every((number) => typeof number === 'number' && Number.isFinite(number))
  );
}

export function createSearchIndex(root: string) {
  let documents = new Map<string, IndexedDocument>();
  const postings = new Map<string, Set<string>>();
  const documentTerms = new Map<string, string[]>();
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  function updatePostings(next: Map<string, IndexedDocument>) {
    for (const [relative, terms] of documentTerms) {
      if (next.get(relative) === documents.get(relative)) continue;
      for (const term of terms) {
        const paths = postings.get(term);
        paths?.delete(relative);
        if (!paths?.size) postings.delete(term);
      }
      documentTerms.delete(relative);
    }
    for (const [relative, doc] of next) {
      if (documentTerms.has(relative)) continue;
      const terms = [...new Set(`${doc.path} ${doc.title} ${doc.text}`.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])];
      documentTerms.set(relative, terms);
      for (const term of terms) {
        let paths = postings.get(term);
        if (!paths) {
          paths = new Set<string>();
          postings.set(term, paths);
        }
        paths.add(relative);
      }
    }
  }

  function serialized(operation: () => Promise<void>) {
    const result = queue.then(async () => {
      if (!disposed) await operation();
    });
    queue = result.catch(() => undefined);
    return result;
  }

  async function persist(next: Map<string, IndexedDocument>) {
    await ensureMetadataDirectory(root);
    const destination = await checkedVaultPath(root, '.a11ynotebook/search-index.json', true);
    const temporary = path.join(root, '.a11ynotebook', `search-index-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: VERSION, root, documents: [...next.values()] }));
        await file.sync();
      } finally {
        await file.close();
      }
      await checkedVaultPath(root, '.a11ynotebook');
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function rebuild() {
    const next = new Map<string, IndexedDocument>();
    async function walk(relativeDirectory: string) {
      const directory = relativeDirectory ? await checkedVaultPath(root, relativeDirectory) : root;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        try {
          if (entry.isDirectory()) {
            await walk(relative);
          } else if (entry.isFile()) {
            const extension = path.extname(entry.name).toLowerCase();
            const target = await checkedVaultPath(root, relative);
            const stat = await lstat(target);
            if (!stat.isFile()) continue;
            const cached = documents.get(relative);
            if (
              cached &&
              cached.size === stat.size &&
              cached.mtime === stat.mtimeMs &&
              cached.ctime === stat.ctimeMs &&
              cached.ino === stat.ino
            ) {
              next.set(relative, cached);
              continue;
            }
            const isDocument = extension === '.pdf' || extension === '.epub';
            const textRead =
              TEXT_EXTENSIONS.has(extension) && stat.size <= MAX_FILE_BYTES
                ? await readSafeText(root, relative, MAX_FILE_BYTES)
                : null;
            const documentRead =
              isDocument && stat.size <= MAX_INDEXED_DOCUMENT_BYTES
                ? await readSafeBuffer(root, relative, MAX_INDEXED_DOCUMENT_BYTES)
                : null;
            const content = textRead?.content ?? '';
            const documentText = documentRead ? extractDocumentText(documentRead.content, extension) : '';
            const indexedStat = textRead?.stat ?? documentRead?.stat ?? stat;
            const title =
              extension === '.md'
                ? content.match(/^#\s+(.+)$/m)?.[1]?.trim()
                : extension === '.html'
                  ? content.match(/<h1\b[^>]*>([^<]*)<\/h1>/i)?.[1]?.trim()
                  : undefined;
            next.set(relative, {
              path: relative,
              title: (title ?? path.basename(relative, extension)).slice(0, 1000),
              kind: ['.md', '.html'].includes(extension) ? 'note' : 'attachment',
              notebook: path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative),
              tags:
                extension === '.md'
                  ? extractTags(content)
                  : extension === '.html'
                    ? extractTags(extractText(content, extension))
                    : [],
              text: isDocument ? documentText : extractText(content, extension),
              size: indexedStat.size,
              mtime: indexedStat.mtimeMs,
              ctime: indexedStat.ctimeMs,
              ino: indexedStat.ino,
            });
          }
        } catch (error) {
          // Deletions and symlink replacements during discovery must not retain stale results.
          if (
            !['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '') &&
            !(error instanceof Error && error.message.includes('Symbolic links'))
          )
            throw error;
        }
      }
    }
    await walk('');
    await persist(next);
    updatePostings(next);
    documents = next;
  }

  async function initialize() {
    return serialized(async () => {
      await ensureMetadataDirectory(root);
      try {
        const read = await readSafeText(root, '.a11ynotebook/search-index.json', MAX_CACHE_BYTES);
        const cache: unknown = read && JSON.parse(read.content);
        if (cache && typeof cache === 'object') {
          const candidate = cache as { version?: number; root?: string; documents?: unknown[] };
          if (
            candidate.version === VERSION &&
            candidate.root === root &&
            Array.isArray(candidate.documents) &&
            candidate.documents.every(validCachedDocument)
          ) {
            documents = new Map(candidate.documents.map((doc) => [doc.path, doc]));
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await rebuild();
    });
  }

  async function search(value: unknown): Promise<VaultSearchResult[]> {
    const query = validateSearchQuery(value);
    await queue;
    if (disposed) throw new Error('Search index is closed.');
    const terms = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let candidates: Set<string> | undefined;
    for (const term of terms) {
      if (!/^[\p{L}\p{N}_]+$/u.test(term)) continue;
      const matches = new Set<string>();
      for (const [token, paths] of postings) {
        if (token.includes(term)) for (const relative of paths) matches.add(relative);
      }
      candidates = candidates ? new Set([...candidates].filter((relative) => matches.has(relative))) : matches;
      if (!candidates.size) return [];
    }
    const results: VaultSearchResult[] = [];
    for (const relative of candidates ?? documents.keys()) {
      const doc = documents.get(relative)!;
      if (query.kind && query.kind !== doc.kind) continue;
      if (
        query.notebook !== undefined &&
        doc.notebook !== query.notebook &&
        !(query.notebook && doc.notebook.startsWith(`${query.notebook}/`))
      )
        continue;
      if (query.tag && !doc.tags.includes(query.tag.replace(/^#/, '').toLowerCase().trim())) continue;
      if (query.modifiedAfter && doc.mtime < Date.parse(query.modifiedAfter)) continue;
      if (query.modifiedBefore && doc.mtime > Date.parse(query.modifiedBefore)) continue;
      const title = doc.title.toLowerCase();
      const text = doc.text.toLowerCase();
      const filename = doc.path.toLowerCase();
      if (!terms.every((term) => title.includes(term) || text.includes(term) || filename.includes(term))) continue;
      const score = terms.reduce(
        (total, term) =>
          total + (title.includes(term) ? 10 : 0) + (filename.includes(term) ? 5 : 0) + (text.includes(term) ? 1 : 0),
        0,
      );
      const match = terms.length ? text.indexOf(terms[0]) : 0;
      const start = Math.max(0, match - 60);
      const snippet = `${start ? '…' : ''}${doc.text.slice(start, start + 220)}${doc.text.length > start + 220 ? '…' : ''}`;
      results.push({
        path: doc.path,
        title: doc.title,
        kind: doc.kind,
        notebook: doc.notebook,
        tags: [...doc.tags],
        modified: new Date(doc.mtime).toISOString(),
        snippet,
        score,
      });
    }
    return results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, query.limit ?? 50);
  }

  async function getTags(): Promise<string[]> {
    await queue;
    if (disposed) throw new Error('Search index is closed.');
    return [...new Set([...documents.values()].flatMap((doc) => doc.tags))].sort();
  }

  return {
    initialize,
    refresh: () => serialized(rebuild),
    search,
    getTags,
    dispose: async () => {
      disposed = true;
      await queue;
      documents.clear();
      postings.clear();
      documentTerms.clear();
    },
  };
}
