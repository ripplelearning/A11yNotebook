import { describe, expect, it } from 'vitest';
import {
  cleanOcrText,
  isOcrLanguageCode,
  mergeOcrTexts,
  ocrCopyFileName,
  ocrLanguageName,
  splitOcrParagraphs,
} from '../shared/ocr';
import { extractWords } from '../renderer/features/previews/ocr-engine';

describe('OCR shared helpers', () => {
  it('cleans recognized text without dropping its words', () => {
    expect(cleanOcrText('  HELLO\f\n\n\nWORLD  \n')).toBe('HELLO\n\nWORLD');
    expect(cleanOcrText('')).toBe('');
  });

  it('splits recognized text into paragraphs on blank lines', () => {
    expect(splitOcrParagraphs('First line\nsecond line\n\nSecond paragraph')).toEqual([
      'First line second line',
      'Second paragraph',
    ]);
    expect(splitOcrParagraphs('   \n\n  ')).toEqual([]);
  });

  it('merges OCR text only into units with no extractable text', () => {
    const { texts, gained } = mergeOcrTexts(
      ['Real text', '', '   '],
      new Map([
        [0, 'SHOULD NOT APPEAR'],
        [1, 'Recognized one'],
        [2, '  '],
        [9, 'Out of range'],
      ]),
    );
    expect(texts).toEqual(['Real text', 'Recognized one', '   ']);
    expect(gained).toBe(1);
  });

  it('names the Alius OCR copy after the original file', () => {
    expect(ocrCopyFileName('Book.pdf')).toBe('Book (OCR).pdf');
    expect(ocrCopyFileName('My Book.epub')).toBe('My Book (OCR).epub');
    // The save handler strips the .alius suffix before calling this.
    expect(ocrCopyFileName('Book.pdf.alius')).toBe('Book.pdf.alius (OCR)');
  });

  it('names offered languages and rejects unknown codes', () => {
    expect(ocrLanguageName('eng')).toBe('English');
    expect(ocrLanguageName('chi_sim')).toBe('Chinese (Simplified)');
    expect(isOcrLanguageCode('eng')).toBe(true);
    expect(isOcrLanguageCode('xx')).toBe(false);
  });

  it('flattens Tesseract word boxes and drops empty words', () => {
    expect(
      extractWords([
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: 'HELLO', confidence: 95, bbox: { x0: 10, y0: 20, x1: 90, y1: 40 } },
                    { text: ' ', confidence: 0, bbox: { x0: 90, y0: 20, x1: 95, y1: 40 } },
                    { text: '', confidence: 0, bbox: { x0: 95, y0: 20, x1: 100, y1: 40 } },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual([{ text: 'HELLO', x0: 10, y0: 20, x1: 90, y1: 40, confidence: 95 }]);
    expect(extractWords(null)).toEqual([]);
    expect(extractWords(undefined)).toEqual([]);
  });
});
