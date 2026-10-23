import { ANNOTATION_COLORS, type AnnotationColor } from './annotations';

export const DOCX_ANNOTATION_SCHEMA_VERSION = 1 as const;
export const DOCX_ANNOTATION_COLORS = ANNOTATION_COLORS;
export type DocxAnnotationColor = AnnotationColor;

/**
 * A DOCX annotation anchor: the block (paragraph or table cell paragraph,
 * by index into the parsed structure's flattened block texts), plus the
 * note-style text anchor (quote with surrounding context and offsets)
 * within that block's text. If the document is edited externally, the
 * block text search re-resolves the anchor or reports it orphaned —
 * the same confidence model as note annotations, scoped per block.
 */
export interface DocxAnnotationAnchor {
  blockIndex: number;
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface DocxAnnotation {
  id: string;
  path: string;
  anchor: DocxAnnotationAnchor;
  color: DocxAnnotationColor;
  label: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: typeof DOCX_ANNOTATION_SCHEMA_VERSION;
}

export type NewDocxAnnotation = Pick<DocxAnnotation, 'path' | 'anchor' | 'color' | 'label' | 'comment'>;
export type DocxAnnotationUpdate = Partial<Pick<DocxAnnotation, 'color' | 'label' | 'comment'>>;

export const DOCX_ANNOTATION_LIMITS = {
  quote: 10_000,
  context: 64,
  label: 100,
  comment: 10_000,
  records: 5_000,
  blockIndex: 1_000_000,
} as const;

export type DocxAnchorStatus = 'anchored' | 'ambiguous' | 'orphan';

/**
 * Resolve an anchor against its block's current text. The recorded
 * offsets win when they still match; otherwise the quote is searched —
 * a unique occurrence (or one disambiguated by prefix/suffix context)
 * re-anchors, repeated unmatched occurrences are ambiguous, and a
 * missing quote is orphaned.
 */
export function resolveDocxAnchor(
  blockText: string,
  anchor: DocxAnnotationAnchor,
): { start: number; end: number; status: DocxAnchorStatus } {
  if (
    anchor.start >= 0 &&
    anchor.end === anchor.start + anchor.quote.length &&
    blockText.slice(anchor.start, anchor.end) === anchor.quote
  ) {
    return { start: anchor.start, end: anchor.end, status: 'anchored' };
  }
  const candidates: number[] = [];
  for (let index = blockText.indexOf(anchor.quote); index !== -1; index = blockText.indexOf(anchor.quote, index + 1)) {
    candidates.push(index);
  }
  if (candidates.length === 0) return { start: -1, end: -1, status: 'orphan' };
  if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + anchor.quote.length, status: 'anchored' };
  const contextual = candidates.filter(
    (start) =>
      (!anchor.prefix || blockText.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) &&
      (!anchor.suffix ||
        blockText.slice(start + anchor.quote.length, start + anchor.quote.length + anchor.suffix.length) ===
          anchor.suffix),
  );
  if (contextual.length === 1)
    return { start: contextual[0], end: contextual[0] + anchor.quote.length, status: 'anchored' };
  return { start: -1, end: -1, status: 'ambiguous' };
}
