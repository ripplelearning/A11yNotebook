// Retarget one broken link in note source: rewrite every occurrence of
// a single written target to a new note, leaving fenced blocks, inline
// code, and unrelated links untouched. Pure and runtime-free, so the
// renderer can read a note, apply it, and save the result with the
// original content as the expected previous content. Returns null when
// nothing matched, so callers can report "already changed" instead of
// writing an identical file.

function dirnamePosix(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? '.' : index === 0 ? '/' : value.slice(0, index);
}

function basenamePosix(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? value : value.slice(index + 1);
}

function extnamePosix(value: string): string {
  const base = basenamePosix(value);
  const index = base.lastIndexOf('.');
  return index <= 0 ? '' : base.slice(index);
}

function stripNoteExtension(value: string): string {
  return value.replace(/\.(?:md|html|htm|txt)$/i, '');
}

function relativePosix(fromDir: string, to: string): string {
  const from = fromDir === '.' ? [] : fromDir.split('/').filter(Boolean);
  const target = to.split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) common += 1;
  const up = Array.from({ length: from.length - common }, () => '..');
  return [...up, ...target.slice(common)].join('/') || '.';
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanPart(href: string): string {
  const split = href.search(/[?#]/);
  return split < 0 ? href : href.slice(0, split);
}

function suffixPart(href: string): string {
  const split = href.search(/[?#]/);
  return split < 0 ? '' : href.slice(split);
}

function encodeHref(relative: string): string {
  return relative
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

const FENCE_OR_CODE_OR_LINK =
  /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)|`+[^`\n]*`+|\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]|(!?\[[^\]\n]*\]\()([^)\s]+)((?:\s+["'][^)]*["'])?\))/g;
const DEFINITION =
  /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)|`+[^`\n]*`+|(^|\n)([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)((?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*)(?=\r?\n|$)/g;

function isExternal(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href);
}

export function retargetLinkContent(
  content: string,
  sourcePath: string,
  writtenTarget: string,
  newTargetPath: string,
): string | null {
  const sourceDir = dirnamePosix(sourcePath);
  const writtenClean = cleanPart(writtenTarget);
  const writtenWiki = writtenTarget.split('#')[0].trim().toLocaleLowerCase();
  const writtenHrefClean = decode(writtenClean).toLocaleLowerCase();

  if (/\.html?$/i.test(sourcePath)) {
    const rewritten = content.replace(/\bhref\s*=\s*("[^"]*"|'[^']*')/gi, (match, quoted: string) => {
      const quote = quoted[0];
      const href = quoted.slice(1, -1);
      if (isExternal(href)) return match;
      if (decode(cleanPart(href)).toLocaleLowerCase() !== writtenHrefClean) return match;
      const relative = relativePosix(sourceDir, newTargetPath);
      return `href=${quote}${encodeHref(relative)}${suffixPart(href)}${quote}`;
    });
    return rewritten === content ? null : rewritten;
  }

  const afterInline = content.replace(
    FENCE_OR_CODE_OR_LINK,
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
        const wikiClean = wiki.split('#')[0].trim().toLocaleLowerCase();
        if (wikiClean !== writtenWiki) return match;
        const fragment = wiki.includes('#') ? wiki.slice(wiki.indexOf('#')) : '';
        const sameNotebook = dirnamePosix(newTargetPath) === sourceDir;
        const replacement = sameNotebook
          ? stripNoteExtension(basenamePosix(newTargetPath))
          : stripNoteExtension(newTargetPath);
        return `[[${replacement}${fragment}${alias ?? ''}]]`;
      }
      if (!href || isExternal(href)) return match;
      if (decode(cleanPart(href)).toLocaleLowerCase() !== writtenHrefClean) return match;
      const extensionless = !extnamePosix(cleanPart(href));
      let relative = relativePosix(sourceDir, newTargetPath);
      if (extensionless) relative = stripNoteExtension(relative);
      return `${prefix}${encodeHref(relative)}${suffixPart(href)}${suffix ?? ''}`;
    },
  );
  const afterDefinitions = afterInline.replace(
    DEFINITION,
    (
      match,
      _fenceLine: string | undefined,
      _fence: string | undefined,
      line: string | undefined,
      prefix: string | undefined,
      rawHref: string | undefined,
      suffix: string | undefined,
    ) => {
      if (prefix === undefined || rawHref === undefined || line === undefined) return match;
      const bracketed = rawHref.startsWith('<');
      const href = bracketed ? rawHref.slice(1, -1) : rawHref;
      if (isExternal(href)) return match;
      if (decode(cleanPart(href)).toLocaleLowerCase() !== writtenHrefClean) return match;
      const extensionless = !extnamePosix(cleanPart(href));
      let relative = relativePosix(sourceDir, newTargetPath);
      if (extensionless) relative = stripNoteExtension(relative);
      const rewritten = `${encodeHref(relative)}${suffixPart(href)}`;
      return `${line}${prefix}${bracketed ? `<${rewritten}>` : rewritten}${suffix ?? ''}`;
    },
  );
  return afterDefinitions === content ? null : afterDefinitions;
}
