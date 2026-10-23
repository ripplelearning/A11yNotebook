import type { NoteAnnotation } from './annotations';

export interface NoteAnnotationExportItem {
  annotation: NoteAnnotation;
  /** Whether the annotation's highlight currently renders (false = orphaned/ambiguous/overlapping). */
  rendered: boolean;
}

/**
 * Plain-text export of a note's annotations with their original quotes —
 * the note-reader counterpart of the PDF notes export, following the
 * same shape: heading per annotation, quote as blockquote, comment, and
 * an explicit status line for highlights that no longer render.
 */
export function formatNoteAnnotationsExport(documentPath: string, items: NoteAnnotationExportItem[]): string {
  const name = documentPath.split('/').at(-1) ?? documentPath;
  const lines: string[] = [`Annotations for ${name}`, ''];
  for (const { annotation, rendered } of items) {
    lines.push(`## ${annotation.label || 'Annotation'} (${annotation.color} highlight)`);
    for (const quoteLine of annotation.anchor.quote.split('\n')) lines.push(`> ${quoteLine}`);
    if (annotation.comment) lines.push(`Comment: ${annotation.comment}`);
    lines.push(
      rendered
        ? 'Status: Highlight shown in the reading view.'
        : 'Status: Highlight unavailable — the text changed, is ambiguous, or overlaps another annotation.',
    );
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
