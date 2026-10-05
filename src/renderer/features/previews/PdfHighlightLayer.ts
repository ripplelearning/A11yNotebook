import type { PdfAnnotationColor } from '../../../shared/pdf-annotation';
import type { PdfPage } from '../../pdf-semantic';
import { pdfNoteRectangles } from './pdf-note-selection';

/** Separate visual layer, mounted imperatively beside the reader's PDF.js canvas. */
export function createPdfHighlightLayer(
  page: PdfPage,
  scale: number,
  rotation: number,
  highlights: Array<{ offset: number; length: number; color: PdfAnnotationColor }>,
): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'pdf-note-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  for (const highlight of highlights) {
    for (const [left, top, width, height] of pdfNoteRectangles(
      page,
      highlight.offset,
      highlight.length,
      scale,
      rotation,
    )) {
      const mark = document.createElement('div');
      mark.className = `pdf-note-highlight pdf-note-color-${highlight.color}`;
      mark.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
      overlay.append(mark);
    }
  }
  return overlay;
}
