import { describe, expect, it, vi } from 'vitest';
import { runOcrUnits, type OcrRunUnit } from '../renderer/features/previews/ocr-runner';
import type { OcrEngine } from '../renderer/features/previews/ocr-engine';

function fakeEngine(recognize: OcrEngine['recognize']): OcrEngine {
  return { recognize, terminate: vi.fn(async () => undefined) };
}

function unit(index: number, images: string[] = [`image-${index}`]): OcrRunUnit {
  return { index, loadImages: async () => images };
}

describe('OCR whole-file run', () => {
  it('recognizes every unit in order and reports progress per unit', async () => {
    const seen: string[] = [];
    const engine = fakeEngine(async (image) => {
      seen.push(String(image));
      return { text: `Text for ${image}`, words: [] };
    });
    const statuses: string[] = [];
    const outcome = await runOcrUnits({
      engine,
      units: [unit(0), unit(1), unit(2)],
      total: 3,
      onProgress: (progress) => statuses.push(progress.status),
      isCancelled: () => false,
    });
    expect(outcome.cancelled).toBe(false);
    expect(seen).toEqual(['image-0', 'image-1', 'image-2']);
    expect(outcome.results.get(1)?.text).toBe('Text for image-1');
    expect(statuses).toContain('Recognized 3 of 3.');
  });

  it('joins the images of one unit and keeps word boxes only for a single canvas image', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    const engine = fakeEngine(async () => ({
      text: 'HELLO',
      words: [{ text: 'HELLO', x0: 1, y0: 2, x1: 3, y1: 4, confidence: 90 }],
    }));
    const outcome = await runOcrUnits({
      engine,
      units: [{ index: 0, loadImages: async () => [canvas] }],
      total: 1,
      onProgress: () => undefined,
      isCancelled: () => false,
    });
    const result = outcome.results.get(0);
    expect(result?.text).toBe('HELLO');
    expect(result?.words).toHaveLength(1);
    expect(result?.imageWidth).toBe(200);
    expect(result?.imageHeight).toBe(100);
  });

  it('stops at the next unit boundary when cancelled and keeps earlier results', async () => {
    let cancelled = false;
    const seen: string[] = [];
    const engine = fakeEngine(async (image) => {
      seen.push(String(image));
      if (String(image) === 'image-1') cancelled = true;
      return { text: `Text for ${image}`, words: [] };
    });
    const outcome = await runOcrUnits({
      engine,
      units: [unit(0), unit(1), unit(2)],
      total: 3,
      onProgress: () => undefined,
      isCancelled: () => cancelled,
    });
    expect(outcome.cancelled).toBe(true);
    // The in-flight unit's text is discarded on cancel; earlier units keep theirs.
    expect([...outcome.results.keys()]).toEqual([0]);
    expect(outcome.results.get(0)?.text).toBe('Text for image-0');
    expect(seen).toEqual(['image-0', 'image-1']);
  });

  it('stops before recognizing anything when already cancelled', async () => {
    const recognize = vi.fn(async () => ({ text: 'HELLO', words: [] }));
    const outcome = await runOcrUnits({
      engine: fakeEngine(recognize),
      units: [unit(0)],
      total: 1,
      onProgress: () => undefined,
      isCancelled: () => true,
    });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.results.size).toBe(0);
    expect(recognize).not.toHaveBeenCalled();
  });
});
