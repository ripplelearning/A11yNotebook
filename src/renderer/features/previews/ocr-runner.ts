// Whole-file OCR orchestration: recognize every unit in order, report
// progress, and stop cleanly on cancel.
//
// The engine is created by the caller (the dialog), so the run itself is
// engine-agnostic and unit-testable with a fake engine: the fake returns
// canned text, ticks progress, or never resolves, and the tests assert
// the run still reports progress, still finishes, or still cancels.
//
// Images load lazily, one unit at a time: a whole book's rendered pages
// must never sit in memory at once (a 500-page book at OCR resolution
// would be gigabytes of canvases).
import { cleanOcrText, type OcrPageResult, type OcrProgress } from '../../../shared/ocr';
import type { OcrEngine, OcrImageInput } from './ocr-engine';

/** One unit to recognize: its 0-based index and how to load its images. */
export interface OcrRunUnit {
  index: number;
  loadImages: () => Promise<OcrImageInput[]>;
}

export interface OcrRunOutcome {
  /** True when the user cancelled before every unit was recognized. */
  cancelled: boolean;
  /** Results by 0-based unit index (page or spine section). */
  results: Map<number, OcrPageResult>;
}

/**
 * Recognize every unit, in order. Between units — and between the images
 * of one unit — the run checks `isCancelled` and stops: the in-flight
 * recognition is left to finish in the background and its text is
 * discarded, because terminating the worker mid-recognition can leave
 * its promise unsettled. The caller terminates the engine afterwards.
 * Progress is reported per unit, with `pageProgress` carried by the
 * engine logger the caller attached when creating the engine.
 */
export async function runOcrUnits(options: {
  engine: OcrEngine;
  units: ReadonlyArray<OcrRunUnit>;
  total: number;
  onProgress: (progress: OcrProgress) => void;
  isCancelled: () => boolean;
}): Promise<OcrRunOutcome> {
  const { engine, units, total, onProgress, isCancelled } = options;
  const results = new Map<number, OcrPageResult>();
  let done = 0;
  const report = (phase: OcrProgress['phase'], pageProgress: number, status: string): void => {
    onProgress({ phase, done, total, pageProgress, status });
  };
  for (const unit of units) {
    if (isCancelled()) return { cancelled: true, results };
    const images = await unit.loadImages();
    const texts: string[] = [];
    let words: OcrPageResult['words'] = [];
    let imageWidth = 0;
    let imageHeight = 0;
    for (const image of images) {
      if (isCancelled()) return { cancelled: true, results };
      report('recognizing', 0, `Recognizing ${done + 1} of ${total}.`);
      const recognized = await engine.recognize(image);
      if (isCancelled()) return { cancelled: true, results };
      if (recognized.text) texts.push(recognized.text);
      // Word boxes only map onto a page when the unit is a single PDF
      // page canvas; a section's images each have their own coordinates,
      // and the ePub save does not use boxes.
      if (images.length === 1 && image instanceof HTMLCanvasElement) {
        words = recognized.words;
        imageWidth = image.width;
        imageHeight = image.height;
      }
    }
    const text = cleanOcrText(texts.join('\n\n'));
    results.set(unit.index, { index: unit.index, text, words, imageWidth, imageHeight });
    done += 1;
    report('recognizing', 1, `Recognized ${done} of ${total}.`);
  }
  return { cancelled: false, results };
}
