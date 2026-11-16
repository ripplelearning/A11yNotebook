import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import {
  groupPdfFormFields,
  normalizePdfWidgetAnnotation,
  type PdfFormField,
  type PdfWidgetAnnotation,
} from '../../shared/pdf-form';
import type { TextModel } from './text-model';
import { ViewportTransform } from './viewport-transform';

/**
 * Extract the fillable fields of one PDF page from its widget
 * annotations, in reading order (top of the page first, then left to
 * right), with radio buttons that share a field name grouped.
 *
 * Labels come from the field's tooltip first; when a field has none, the
 * text on the line nearest the field is used, mirroring how a sighted
 * reader pairs a field with the text beside it. Fields whose widget sits
 * where the page holds no text fall back to the field name.
 */
export function extractPageFormFields(
  annotations: PdfWidgetAnnotation[],
  pageNum: number,
  textModel: TextModel,
  view: [number, number, number, number],
  rotation = 0,
): PdfFormField[] {
  const fields: PdfFormField[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Widget') continue;
    const rect = annotation.rect;
    const nearbyText =
      Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite)
        ? nearbyTextForRect(textModel, rect as [number, number, number, number], view, rotation)
        : '';
    const field = normalizePdfWidgetAnnotation(annotation, pageNum, nearbyText);
    if (field) fields.push(field);
  }
  // Reading order: PDF y grows upward, so the topmost widget comes
  // first; widgets on the same line order left to right.
  fields.sort((a, b) => b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
  return groupPdfFormFields(fields);
}

/**
 * The text on the line nearest a widget rectangle: the text item closest
 * to the widget's top edge, trimmed to the words on that line. Returns
 * '' when the page holds no text near the widget.
 */
export function nearbyTextForRect(
  textModel: TextModel,
  rect: [number, number, number, number],
  view: [number, number, number, number],
  rotation = 0,
): string {
  const transform = new ViewportTransform(view, 1, rotation);
  const [widgetLeft, widgetTop] = transform.pdfPoint(rect[0], rect[3]);
  const [widgetRight, widgetBottom] = transform.pdfPoint(rect[2], rect[1]);
  const widgetBox = {
    left: Math.min(widgetLeft, widgetRight),
    right: Math.max(widgetLeft, widgetRight),
    top: Math.min(widgetTop, widgetBottom),
    bottom: Math.max(widgetTop, widgetBottom),
  };
  // The label usually sits on the same line as the field (beside it) or
  // just above it. Same-line text wins over nearer text on another line:
  // a field's top edge is closer to the line above than to its own label
  // beside it, so plain nearest-item distance picks the wrong line.
  let best: { offset: number; sameLine: boolean; distance: number } | undefined;
  for (const item of textModel.items) {
    if (!item.transform || !item.text.trim()) continue;
    const [a, b, c, d, pdfX, pdfY] = item.transform;
    const baselineLength = Math.hypot(a, b) || 1;
    const verticalLength = Math.hypot(c, d) || 1;
    const corners = [
      [pdfX, pdfY],
      [pdfX + (a / baselineLength) * item.width, pdfY + (b / baselineLength) * item.width],
      [pdfX + (c / verticalLength) * item.height, pdfY + (d / verticalLength) * item.height],
      [
        pdfX + (a / baselineLength) * item.width + (c / verticalLength) * item.height,
        pdfY + (b / baselineLength) * item.width + (d / verticalLength) * item.height,
      ],
    ].map(([x, y]) => transform.pdfPoint(x, y));
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    const sameLine = box.bottom > widgetBox.top && box.top < widgetBox.bottom;
    const dx =
      box.right < widgetBox.left
        ? widgetBox.left - box.right
        : box.left > widgetBox.right
          ? box.left - widgetBox.right
          : 0;
    const dy =
      box.bottom < widgetBox.top
        ? widgetBox.top - box.bottom
        : box.top > widgetBox.bottom
          ? box.top - widgetBox.bottom
          : 0;
    const distance = dx * dx + dy * dy;
    if (!best || (sameLine && !best.sameLine) || (sameLine === best.sameLine && distance < best.distance)) {
      best = { offset: item.startOffset, sameLine, distance };
    }
  }
  if (!best) return '';
  const offset = best.offset;
  const text = textModel.fullText;
  if (offset < 0 || offset >= text.length) return '';
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
  // A label line is short; a body-text line is not a label for the field.
  if (!line || line.length > 100) return '';
  return line;
}

/** Extract the fillable fields of a loaded page proxy. */
export async function extractFormFields(
  page: PDFPageProxy,
  pageNum: number,
  textModel: TextModel,
  view: [number, number, number, number],
  rotation = 0,
): Promise<PdfFormField[]> {
  const annotations = (await page.getAnnotations()) as PdfWidgetAnnotation[];
  return extractPageFormFields(annotations, pageNum, textModel, view, rotation);
}
