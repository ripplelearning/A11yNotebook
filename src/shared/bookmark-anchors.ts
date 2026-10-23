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
export function headingAnchorAt(content: string, isHtml: boolean, offset: number): BookmarkAnchor | null {
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
