import type { BookmarkAnchor } from './types';

// Heading/position bookmark anchors. A heading anchor stores the heading
// text and which occurrence of that exact text it is, so it survives
// edits elsewhere in the note; an offset anchor stores a character
// position. Resolution is pure text work so it is fully unit-testable.

interface HeadingHit {
  text: string;
  start: number;
}

const MARKDOWN_HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const HTML_HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

function stripHtml(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, '')).trim();
}

/**
 * Common named HTML entities, for the pure-text heading comparison.
 * A rendered heading reads `©` while its source stores `&copy;`, so
 * the two forms must decode to the same text or the jump never matches.
 * This module also runs in the main process, where there is no DOM, so
 * the decoding is plain text work: numeric entities plus the named
 * entities a note heading realistically contains. Unknown entities are
 * left as written.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  middot: '·',
  bull: '•',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  lsaquo: '‹',
  rsaquo: '›',
  sbquo: '‚',
  bdquo: '„',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/&#(\d+);/g, (match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

/**
 * The heading text as the reader sees it: inline Markdown formatting
 * stripped. A heading stored from source (`# Hello *world*`) anchors as
 * `Hello *world*` but renders as `Hello world`, so the two forms must be
 * compared in their rendered shape or the jump never matches.
 *
 * Wiki links and images need the same treatment: `[[Usage]]` renders as
 * a link reading `Usage` (or its label when written `[[Target|label]]`),
 * and an image contributes no text to the rendered heading at all, so
 * keeping the `[[...]]` markup or the image's alt text leaves the
 * stored form unable to match the rendered heading. The bookmark then
 * cannot be created from reading mode, and a jump to it falls back to
 * the top of the note while still announcing the jump.
 *
 * A footnote reference (`[^1]`) renders as a superscript number, so it
 * is dropped too: the rendered heading reads `Usage[1]`, which no
 * source-side strip can produce, so the position fallback (see
 * headingSourceIndex) is what lands the jump — the strip only keeps the
 * suggested name and the announcement reading `Usage` instead of
 * `Usage[^1]`.
 */
export function normalizeHeadingText(text: string): string {
  return stripHtml(
    text
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1')
      .replace(/<([^<>\s]+@[^<>\s]+)>/g, '$1')
      .replace(/\[\^[^\]]*\]/g, '')
      .replace(/(`{1,3})([^`]*?)\1/g, '$2')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1'),
  ).trim();
}

/** Every heading in document order, with the character offset where it starts. */
export function listHeadings(content: string, isHtml: boolean): HeadingHit[] {
  if (isHtml) {
    const hits: HeadingHit[] = [];
    for (const match of content.matchAll(HTML_HEADING)) {
      const text = stripHtml(match[1] ?? '');
      if (text) hits.push({ text, start: match.index ?? 0 });
    }
    return hits;
  }
  const hits: HeadingHit[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const match = MARKDOWN_HEADING.exec(line);
      if (match?.[1]) hits.push({ text: match[1].trim(), start: offset });
    }
    offset += line.length + 1;
  }
  return hits;
}

/**
 * The heading anchor for the heading at or before `offset` — what "bookmark
 * this heading" means when the caret sits inside a section. Returns null
 * when the caret is before the first heading.
 */
export function headingAnchorAt(content: string, isHtml: boolean, offset: number): Extract<BookmarkAnchor, { kind: 'heading' }> | null {
  const headings = listHeadings(content, isHtml);
  let current: HeadingHit | null = null;
  for (const hit of headings) {
    if (hit.start <= offset) current = hit;
    else break;
  }
  if (!current) return null;
  const occurrence = headings.filter((hit) => hit.text === current!.text && hit.start < current!.start).length;
  return { kind: 'heading', text: current.text, occurrence };
}

/** The character offset an anchor points at, or null when its heading is gone. A PDF page anchor has no meaning inside note text. */
export function resolveBookmarkAnchor(content: string, isHtml: boolean, anchor: BookmarkAnchor): number | null {
  if (anchor.kind === 'page') return null;
  if (anchor.kind === 'offset') return Math.max(0, Math.min(anchor.offset, content.length));
  const matches = listHeadings(content, isHtml).filter((hit) => hit.text === anchor.text);
  const hit = matches[anchor.occurrence] ?? matches[0];
  return hit ? hit.start : null;
}

/**
 * The source-heading index of a heading anchor: where the anchor's
 * heading sits among the note's headings in source order. Null when
 * the anchor does not resolve (the heading is gone). The reading view
 * renders headings in the same order, so when the rendered list has
 * the same length as the source list, this index identifies the
 * rendered heading even when its text cannot be compared — a footnote
 * reference, an HTML entity, or any other form the normalizer does not
 * understand.
 */
export function headingSourceIndex(
  content: string,
  isHtml: boolean,
  anchor: Extract<BookmarkAnchor, { kind: 'heading' }>,
): number | null {
  const start = resolveBookmarkAnchor(content, isHtml, anchor);
  if (start === null) return null;
  const index = listHeadings(content, isHtml).findIndex((hit) => hit.start === start);
  return index >= 0 ? index : null;
}

/**
 * The heading anchor for the source heading at `index` (0-based, in
 * source order), with the occurrence among same-text headings. Null
 * when the index is out of range.
 */
export function headingAnchorAtSourceIndex(
  content: string,
  isHtml: boolean,
  index: number,
): Extract<BookmarkAnchor, { kind: 'heading' }> | null {
  const hits = listHeadings(content, isHtml);
  const hit = hits[index] ?? null;
  if (!hit) return null;
  const occurrence = hits.filter((item) => item.text === hit.text && item.start < hit.start).length;
  return { kind: 'heading', text: hit.text, occurrence };
}

/**
 * The heading to focus when opening an anchor in the reading view: the
 * anchor's own heading, or for a position anchor the heading at or
 * before that position (the section containing it). Null when the note
 * has no heading at or before the place.
 */
export function readingJumpHeading(
  content: string,
  isHtml: boolean,
  anchor: BookmarkAnchor,
): Extract<BookmarkAnchor, { kind: 'heading' }> | null {
  if (anchor.kind === 'heading') {
    return resolveBookmarkAnchor(content, isHtml, anchor) === null ? null : anchor;
  }
  if (anchor.kind === 'page') return null;
  return headingAnchorAt(content, isHtml, anchor.offset);
}

/**
 * The source span of a heading anchor's text, so an edit-mode jump can
 * select the heading text instead of dropping a collapsed caret on it.
 * Null for a position anchor (which lands on its own line instead) or
 * when the heading is gone.
 */
export function headingTextSpan(
  content: string,
  isHtml: boolean,
  anchor: BookmarkAnchor,
): { start: number; end: number } | null {
  if (anchor.kind !== 'heading') return null;
  const start = resolveBookmarkAnchor(content, isHtml, anchor);
  if (start === null) return null;
  const textStart = content.indexOf(anchor.text, start);
  if (textStart === -1) return null;
  return { start: textStart, end: textStart + anchor.text.length };
}

/**
 * The source span of the trimmed line containing `offset`, for a position
 * anchor with no heading to land on. Null when the line is blank.
 */
export function lineSpanAt(content: string, offset: number): { start: number; end: number } | null {
  const clamped = Math.max(0, Math.min(offset, content.length));
  const lineStart = content.lastIndexOf('\n', clamped - 1) + 1;
  const lineEnd = content.indexOf('\n', clamped);
  const end = lineEnd === -1 ? content.length : lineEnd;
  const line = content.slice(lineStart, end);
  const start = lineStart + (line.length - line.trimStart().length);
  const trimmedEnd = end - (line.length - line.trimEnd().length);
  if (trimmedEnd <= start) return null;
  return { start, end: trimmedEnd };
}

/**
 * The text around an offset, for naming a position bookmark: the rendered
 * form of the trimmed line at the offset, or the nearest non-blank line
 * above it when the caret sits on a blank line. Truncated to `maxLength`
 * characters. Empty when the note has no text around the offset.
 */
export function surroundingText(content: string, offset: number, maxLength = 60): string {
  const clamped = Math.max(0, Math.min(offset, content.length));
  const lines = content.split('\n');
  let remaining = clamped;
  let index = 0;
  for (; index < lines.length; index += 1) {
    if (remaining <= lines[index].length) break;
    remaining -= lines[index].length + 1;
  }
  for (let lineIndex = Math.min(index, lines.length - 1); lineIndex >= 0; lineIndex -= 1) {
    // A heading line names itself without its markers.
    const text = normalizeHeadingText(lines[lineIndex].replace(/^ {0,3}#{1,6}\s+/, '')).trim();
    if (text) return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  }
  return '';
}

/** The source anchor for a rendered heading: the source heading whose
 * rendered text matches, at the same occurrence among same-text
 * headings. A rendered heading reads `Hello world` while its source
 * stores `Hello *world*`, so the match is on the normalized text.
 * Null when no source heading matches (the heading is gone, or the
 * rendered text came from elsewhere).
 */
export function headingAnchorForRenderedText(
  content: string,
  isHtml: boolean,
  renderedText: string,
  occurrence: number,
): Extract<BookmarkAnchor, { kind: 'heading' }> | null {
  const wanted = normalizeHeadingText(renderedText);
  const matches = listHeadings(content, isHtml).filter((hit) => normalizeHeadingText(hit.text) === wanted);
  const hit = matches[occurrence] ?? null;
  if (!hit) return null;
  return { kind: 'heading', text: hit.text, occurrence };
}

/** Whether two anchors point at the same place, by value rather than by object identity. */
export function sameAnchor(
  a: BookmarkAnchor | null | undefined,
  b: BookmarkAnchor | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'heading' && b.kind === 'heading') return a.text === b.text && a.occurrence === b.occurrence;
  if (a.kind === 'offset' && b.kind === 'offset') return a.offset === b.offset;
  if (a.kind === 'page' && b.kind === 'page') return a.page === b.page && a.offset === b.offset;
  return false;
}

/**
 * The bookmarks of one note in document order, each with the character
 * offset it resolves to. Anchors that no longer resolve (a heading that
 * was deleted) are left out — there is nowhere to jump to. The sort is
 * stable, so bookmarks at the same offset keep their listed order.
 */
export function orderBookmarksByOffset<T extends { anchor?: BookmarkAnchor }>(
  content: string,
  isHtml: boolean,
  bookmarks: readonly T[],
): { bookmark: T; offset: number }[] {
  return bookmarks
    .map((bookmark, index) => {
      const offset = bookmark.anchor ? resolveBookmarkAnchor(content, isHtml, bookmark.anchor) : null;
      return offset === null ? null : { bookmark, offset, index };
    })
    .filter((item): item is { bookmark: T; offset: number; index: number } => item !== null)
    .sort((a, b) => a.offset - b.offset || a.index - b.index)
    .map(({ bookmark, offset }) => ({ bookmark, offset }));
}

/** Validate an untrusted anchor value (bookmark files are user-editable JSON). */
export function sanitizeBookmarkAnchor(value: unknown): BookmarkAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const anchor = value as Partial<BookmarkAnchor>;
  if (anchor.kind === 'heading') {
    const heading = anchor as { text?: unknown; occurrence?: unknown };
    if (typeof heading.text === 'string' && heading.text && Number.isInteger(heading.occurrence) && (heading.occurrence as number) >= 0)
      return { kind: 'heading', text: heading.text, occurrence: heading.occurrence as number };
    return undefined;
  }
  if (anchor.kind === 'offset') {
    const offset = (anchor as { offset?: unknown }).offset;
    if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) return { kind: 'offset', offset: Math.floor(offset) };
  }
  if (anchor.kind === 'page') {
    const page = (anchor as { page?: unknown }).page;
    const offset = (anchor as { offset?: unknown }).offset;
    if (
      typeof page === 'number' &&
      Number.isInteger(page) &&
      page >= 1 &&
      typeof offset === 'number' &&
      Number.isFinite(offset) &&
      offset >= 0
    )
      return { kind: 'page', page, offset: Math.floor(offset) };
  }
  return undefined;
}
