import type { PdfAnnotation } from './pdf-annotation';

export interface PdfNoteExportItem {
  note: PdfAnnotation;
  /** Location status as currently resolved against the open document, when known. */
  status?: string;
}

/**
 * Plain-text/Markdown export of PDF notes for the clipboard: each note keeps
 * its label, page, the original quoted text exactly as stored, the reader's
 * comment, and its confidence/verification status, so an exported note can
 * be cited or reviewed outside the app without losing provenance.
 */
export function formatPdfNotesExport(documentPath: string, items: PdfNoteExportItem[]): string {
  const name = documentPath.split('/').at(-1) ?? documentPath;
  const lines: string[] = [`PDF notes for ${name}`, ''];
  for (const { note, status } of items) {
    const targets = [note.target, ...(note.targets ?? [])];
    const pages = [...new Set(targets.map((target) => target.page))];
    lines.push(`## ${note.label || 'PDF note'} — page ${pages.join(', ')}`);
    for (const target of targets) {
      for (const quoteLine of target.exactQuote.split('\n')) lines.push(`> ${quoteLine}`);
    }
    if (note.comment) lines.push(`Comment: ${note.comment}`);
    const confidence = [...new Set(targets.map((target) => target.confidence))].join(', ');
    const verification = [...new Set(targets.map((target) => target.verification ?? 'unverified'))].join(', ');
    lines.push(`Confidence: ${confidence}. Verification: ${verification}.`);
    if (status) lines.push(`Location: ${status}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
