// Parses local Markdown references and resolves them to notes or attachments.
import path from 'node:path';
import type { VaultEntry, VaultLink, VaultLinkIndex } from '../../src/shared/types';

interface MarkdownReference {
  target: string;
  isWiki: boolean;
}

/** Extract wiki links and ordinary relative Markdown links from note source. */
export function parseMarkdownLinks(content: string): MarkdownReference[] {
  const references: MarkdownReference[] = [];
  const searchable = content
    .replace(/(^|\n)\s*(```|~~~)[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '$1')
    .replace(/`+[^`\n]*`+/g, '');
  for (const match of searchable.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) {
    references.push({ target: match[1].trim(), isWiki: true });
  }
  for (const match of searchable.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) {
    const target = match[1].trim();
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    references.push({ target, isWiki: false });
  }
  return references;
}

function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...(entry.children ? flattenEntries(entry.children) : [])]);
}

/** Build a simple deterministic link graph from ordinary Markdown files. */
export function buildVaultLinkIndex(
  notes: Array<{ path: string; content: string }>,
  entries: VaultEntry[],
): VaultLinkIndex {
  const allEntries = flattenEntries(entries).filter((entry) => entry.kind !== 'notebook');
  const notesOnly = allEntries.filter((entry) => entry.kind === 'note');
  const byPath = new Map(allEntries.map((entry) => [entry.path.toLocaleLowerCase(), entry]));
  const notesByTitle = new Map<string, VaultEntry[]>();
  for (const note of notesOnly) {
    const title = path.posix.basename(note.path, path.posix.extname(note.path)).toLocaleLowerCase();
    notesByTitle.set(title, [...(notesByTitle.get(title) ?? []), note]);
  }

  const links = notes.flatMap(({ path: sourcePath, content }) =>
    parseMarkdownLinks(content)
      .map(({ target, isWiki }) => {
        let candidatePath = target;
        if (!isWiki) {
          try {
            candidatePath = decodeURIComponent(target.split('#')[0].split('?')[0]);
          } catch {
            candidatePath = target.split('#')[0].split('?')[0];
          }
          if (!candidatePath) return undefined;
          candidatePath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), candidatePath));
          if (!path.posix.extname(candidatePath)) candidatePath += '.md';
        } else {
          candidatePath = '';
        }
        const resolved = isWiki
          ? (notesByTitle.get(target.toLocaleLowerCase()) ?? [])[0]
          : byPath.get(candidatePath.toLocaleLowerCase());
        return {
          sourcePath,
          ...(resolved ? { targetPath: resolved.path } : {}),
          targetTitle: isWiki ? target : path.posix.basename(candidatePath),
          resolved: Boolean(resolved),
          attachment: resolved?.kind === 'attachment',
        } satisfies VaultLink;
      })
      .filter((link): link is VaultLink => link !== undefined),
  );
  return { links };
}
