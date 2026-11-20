// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildOcrPdf } from '../renderer/features/previews/ocr-save';
import type { OcrPageResult } from '../shared/ocr';

async function blankPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/** The extractable text of a PDF, via the real pdf.js. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: false, verbosity: 0 });
  const document = await task.promise;
  let text = '';
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }
  } finally {
    await task.destroy();
  }
  return text;
}

function result(words: OcrPageResult['words'], imageWidth = 1224, imageHeight = 1584): OcrPageResult {
  return { index: 0, text: 'HELLO', words, imageWidth, imageHeight };
}

describe('OCR PDF text layer', () => {
  it('writes recognized words as a hidden, extractable text layer', async () => {
    const bytes = await blankPdf();
    const saved = await buildOcrPdf(
      bytes,
      new Map([
        [
          0,
          result([{ text: 'HELLO', x0: 100, y0: 100, x1: 220, y1: 140, confidence: 96 }]),
        ],
      ]),
      new Map([[0, { width: 612, height: 792, rotation: 0 }]]),
    );
    expect(await pdfText(saved)).toContain('HELLO');
  });

  it('maps word boxes onto a rotated page', async () => {
    const bytes = await blankPdf();
    const saved = await buildOcrPdf(
      bytes,
      new Map([
        [
          0,
          result([{ text: 'HELLO', x0: 100, y0: 100, x1: 220, y1: 140, confidence: 96 }], 1584, 1224),
        ],
      ]),
      new Map([[0, { width: 612, height: 792, rotation: 90 }]]),
    );
    expect(await pdfText(saved)).toContain('HELLO');
  });

  it('writes nothing for a result with no words', async () => {
    const bytes = await blankPdf();
    const saved = await buildOcrPdf(
      bytes,
      new Map([[0, result([])]]),
      new Map([[0, { width: 612, height: 792, rotation: 0 }]]),
    );
    expect(await pdfText(saved)).not.toContain('HELLO');
  });
});
