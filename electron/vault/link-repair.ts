import path from 'node:path';

export interface NoteSource {
  path: string;
  content: string;
}

export interface LinkRepair {
  path: string;
  nextPath: string;
  before: string;
  after: string;
}

function movedPath(notePath: string, source: string, destination: string) {
  return notePath === source || notePath.startsWith(`${source}/`)
    ? destination + notePath.slice(source.length)
    : notePath;
}

function resolveWiki(target: string, notes: NoteSource[]) {
  const clean = target.split('#')[0].trim().replace(/\.md$/i, '').toLowerCase();
  const matches = notes.filter((note) =>
    clean.includes('/')
      ? note.path.replace(/\.md$/i, '').toLowerCase() === clean
      : path.posix.basename(note.path).replace(/\.md$/i, '').toLowerCase() === clean,
  );
  return matches.length === 1 ? matches[0].path : undefined;
}

/** Repair only unambiguous local references, leaving code and external URLs untouched. */
export function planLinkRepair(
  notes: NoteSource[],
  source: string,
  destination: string,
  attachmentPaths: string[] = [],
): LinkRepair[] {
  const notePaths = new Set([...notes.map((note) => note.path), ...attachmentPaths]);
  return notes.flatMap((note) => {
    const nextPath = movedPath(note.path, source, destination);
    const after = note.content.replace(
      /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)|`+[^`\n]*`+|\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]|(!?\[[^\]\n]*\]\()([^)\s]+)((?:\s+["'][^)]*["'])?\))/g,
      (
        match,
        _line,
        _fence,
        wiki: string | undefined,
        alias: string | undefined,
        prefix: string | undefined,
        href: string | undefined,
        suffix: string | undefined,
      ) => {
        if (wiki !== undefined) {
          const resolved = resolveWiki(wiki, notes);
          if (!resolved) return match;
          const target = movedPath(resolved, source, destination);
          if (target === resolved) return match;
          const fragment = wiki.includes('#') ? wiki.slice(wiki.indexOf('#')) : '';
          // Qualified wiki references avoid introducing ambiguity after a move.
          return `[[${target.replace(/\.md$/i, '')}${fragment}${alias ?? ''}]]`;
        }
        if (!href || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) return match;
        const split = href.search(/[?#]/);
        const clean = split < 0 ? href : href.slice(0, split);
        let decoded: string;
        try {
          decoded = decodeURIComponent(clean);
        } catch {
          return match;
        }
        let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(note.path), decoded));
        const extensionless = !path.posix.extname(resolved);
        if (extensionless) resolved += '.md';
        if (!notePaths.has(resolved)) return match;
        const target = movedPath(resolved, source, destination);
        if (target === resolved && nextPath === note.path) return match;
        let relative = path.posix.relative(path.posix.dirname(nextPath), target);
        if (extensionless) relative = relative.replace(/\.md$/i, '');
        const encoded = relative.split('/').map(encodeURIComponent).join('/');
        return `${prefix}${encoded}${split < 0 ? '' : href.slice(split)}${suffix}`;
      },
    );
    return after === note.content ? [] : [{ path: note.path, nextPath, before: note.content, after }];
  });
}
