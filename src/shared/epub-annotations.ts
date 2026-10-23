import { ANNOTATION_COLORS, type AnnotationColor } from './annotations';

export const EPUB_ANNOTATION_SCHEMA_VERSION = 1 as const;
export const EPUB_ANNOTATION_COLORS = ANNOTATION_COLORS;
export type EpubAnnotationColor = AnnotationColor;

/**
 * An ePub annotation anchor: the Canonical Fragment Identifier (CFI)
 * range epub.js produces for a selection, plus the spine section href
 * and the note-style quote/context, which let the reader validate the
 * anchor against the section's text (anchored) or report it orphaned
 * when the CFI no longer resolves to the quoted text — for example
 * after the book file is replaced with a different edition.
 */
export interface EpubAnnotationAnchor {
  cfiRange: string;
  sectionHref: string;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface EpubAnnotation {
  id: string;
  path: string;
  anchor: EpubAnnotationAnchor;
  color: EpubAnnotationColor;
  label: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: typeof EPUB_ANNOTATION_SCHEMA_VERSION;
}

export type NewEpubAnnotation = Pick<EpubAnnotation, 'path' | 'anchor' | 'color' | 'label' | 'comment'>;
export type EpubAnnotationUpdate = Partial<Pick<EpubAnnotation, 'color' | 'label' | 'comment'>>;

export const EPUB_ANNOTATION_LIMITS = {
  cfiRange: 4_096,
  sectionHref: 2_048,
  quote: 10_000,
  context: 64,
  label: 100,
  comment: 10_000,
  records: 5_000,
} as const;

export type EpubAnnotationExportStatus = 'anchored' | 'orphan';

export interface EpubAnnotationExportItem {
  annotation: EpubAnnotation;
  status: EpubAnnotationExportStatus;
}

/** Plain-text export with original quotes and per-annotation status, mirroring the other readers' exports. */
export function formatEpubAnnotationsExport(documentPath: string, items: EpubAnnotationExportItem[]): string {
  const name = documentPath.split('/').at(-1) ?? documentPath;
  const lines: string[] = [`Annotations for ${name}`, ''];
  for (const { annotation, status } of items) {
    lines.push(
      `## ${annotation.label || 'Annotation'} (${annotation.color} highlight) — ${annotation.anchor.sectionHref}`,
    );
    for (const quoteLine of annotation.anchor.quote.split('\n')) lines.push(`> ${quoteLine}`);
    if (annotation.comment) lines.push(`Comment: ${annotation.comment}`);
    lines.push(
      status === 'anchored'
        ? 'Status: Highlight shown in the reading view.'
        : 'Status: Highlight unavailable — the anchor no longer resolves to the quoted text.',
    );
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
