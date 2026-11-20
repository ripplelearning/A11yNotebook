// Writing recognized text back into the file, for the OCR save step.
//
// PDF: a hidden text layer — each recognized word is drawn at its
// position on the page with opacity 0, so the page becomes searchable
// and selectable without changing how it looks. Only pages that had no
// extractable text gain a layer; pages that already read keep their own
// text, so saving never duplicates text in the file.
//
// ePub: the recognized text is appended to the section's document, in a
// marked section the reader picks up as extractable text on the next
// open. Again only sections that had no extractable text are changed.
//
// Both builders work on the file's bytes in the renderer and hand the
// finished bytes to the main process, which owns the privileged write
// (in place for a managed file, a copy for an Alius).
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { splitOcrParagraphs, type OcrPageResult } from '../../../shared/ocr';
import { readEpubSpine } from './ocr-images';

/**
 * Add a hidden text layer to the pages in `results`. `pageSizes` maps a
 * 0-based page index to the page's size in PDF points and its native
 * rotation, and each result carries the pixel size of the image it was
 * recognized from, so word boxes map back onto the page. The image is
 * the page rendered with its rotation applied; the mapping below inverts
 * that rotation, so words land on the text they came from.
 */
export async function buildOcrPdf(
  bytes: Uint8Array,
  results: ReadonlyMap<number, OcrPageResult>,
  pageSizes: ReadonlyMap<number, { width: number; height: number; rotation: number }>,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [index, result] of results) {
    if (result.words.length === 0) continue;
    const size = pageSizes.get(index);
    if (!size || result.imageWidth <= 0 || result.imageHeight <= 0) continue;
    const page = document.getPage(index);
    const rotation = ((size.rotation % 360) + 360) % 360;
    const rotated = rotation === 90 || rotation === 270;
    // Pixels per point along the rendered image's axes.
    const scale = result.imageWidth / (rotated ? size.height : size.width);
    if (!(scale > 0)) continue;
    for (const word of result.words) {
      // The word's left edge and baseline in PDF points, and its size.
      let x: number;
      let y: number;
      let fontSize: number;
      if (rotation === 0) {
        x = word.x0 / scale;
        y = size.height - word.y1 / scale;
        fontSize = (word.y1 - word.y0) / scale;
      } else if (rotation === 180) {
        x = size.width - word.x1 / scale;
        y = word.y0 / scale;
        fontSize = (word.y1 - word.y0) / scale;
      } else if (rotation === 90) {
        x = word.y0 / scale;
        y = size.height - word.x1 / scale;
        fontSize = (word.x1 - word.x0) / scale;
      } else if (rotation === 270) {
        x = size.width - word.y1 / scale;
        y = word.x0 / scale;
        fontSize = (word.x1 - word.x0) / scale;
      } else {
        continue;
      }
      if (!(fontSize > 0)) continue;
      page.drawText(word.text, {
        x,
        y,
        size: Math.min(Math.max(fontSize, 4), 72),
        font,
        opacity: 0,
      });
    }
  }
  return document.save();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Append the recognized text to the sections in `results` (0-based spine
 * index -> text). The text goes into a marked section at the end of the
 * section's body, so the reader's text extraction finds it on the next
 * open. The mimetype entry stays first and uncompressed, as the ePub
 * format requires.
 */
export async function buildOcrEpub(
  bytes: Uint8Array,
  results: ReadonlyMap<number, string>,
): Promise<Uint8Array> {
  const zip = await new JSZip().loadAsync(bytes);
  const sections = await readEpubSpine(bytes);
  for (const [index, text] of results) {
    const sectionPath = sections[index];
    if (!sectionPath) continue;
    const entry = zip.file(sectionPath);
    if (!entry) continue;
    const paragraphs = splitOcrParagraphs(text);
    if (paragraphs.length === 0) continue;
    const content = await entry.async('string');
    const block =
      '<section data-a11y-ocr-text="true" aria-label="Recognized text">' +
      paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('') +
      '</section>';
    const closeBody = content.search(/<\/body\s*>/i);
    const updated =
      closeBody >= 0
        ? `${content.slice(0, closeBody)}${block}${content.slice(closeBody)}`
        : `${content}${block}`;
    zip.file(sectionPath, updated);
  }
  // The mimetype entry must be first and stored, not deflated — a plain
  // round-trip would deflate it. Rebuild the archive with mimetype
  // first (stored) and every other entry after it, in original order.
  const rebuilt = new JSZip();
  const mimetype = zip.file('mimetype');
  if (mimetype) {
    rebuilt.file('mimetype', await mimetype.async('uint8array'), { compression: 'STORE' });
  }
  for (const [name, entry] of Object.entries(zip.files)) {
    if (name === 'mimetype' || entry.dir) continue;
    rebuilt.file(name, await entry.async('uint8array'));
  }
  return rebuilt.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
