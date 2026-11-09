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
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

/**
 * The heading text as the reader sees it: inline Markdown formatting
 * stripped. A heading stored from source (`# Hello *world*`) anchors as
 * `Hello *world*` but renders as `Hello world`, so the two forms must be
 * compared in their rendered shape or the jump never matches.
 */
export function normalizeHeadingText(text: string): string {
  return stripHtml(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
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

/** The character offset an anchor points at, or null when its heading is gone. */
export function resolveBookmarkAnchor(content: string, isHtml: boolean, anchor: BookmarkAnchor): number | null {
  if (anchor.kind === 'offset') return Math.max(0, Math.min(anchor.offset, content.length));
  const matches = listHeadings(content, isHtml).filter((hit) => hit.text === anchor.text);
  const hit = matches[anchor.occurrence] ?? matches[0];
  return hit ? hit.start : null;
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
  return undefined;
}
