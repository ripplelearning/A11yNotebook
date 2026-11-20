// The on-device OCR engine: Tesseract.js running in this renderer, fed
// by the bundled runtime over `ocr-data:` (see electron/ocr-runtime.ts).
// Nothing is uploaded: page images go to the local worker, and the only
// network use in the whole feature is the main process downloading a
// language's trained data once, on demand.
//
// The engine is behind a small interface so tests can substitute a fake
// recognizer: real OCR is slow and its exact wording varies, so unit
// tests assert on the orchestration (progress, cancel, save) with canned
// text, while the end-to-end spec runs the real engine against a fixture
// image with one known word.
import { createWorker, OEM, type LoggerMessage } from 'tesseract.js';
import {
  OCR_DATA_CORE_URL,
  OCR_DATA_LANG_URL,
  OCR_DATA_WORKER_URL,
  cleanOcrText,
  type OcrWord,
} from '../../../shared/ocr';

/** What the recognizer accepts: a rendered page canvas, an image element, a data URL, or a Blob. */
export type OcrImageInput = HTMLCanvasElement | HTMLImageElement | string | Blob;

/** One recognized image: its text plus the word boxes for the PDF text layer. */
export interface OcrRecognizeResult {
  text: string;
  words: OcrWord[];
}

/** The engine surface the OCR run needs: recognize one image, then shut down. */
export interface OcrEngine {
  recognize(image: OcrImageInput): Promise<OcrRecognizeResult>;
  terminate(): Promise<void>;
}

/** Progress reports from the engine, forwarded to the dialog. */
export type OcrEngineLogger = (message: { status: string; progress: number }) => void;

/** Create a real Tesseract engine for one language. */
export async function createTesseractEngine(
  language: string,
  onLogger: OcrEngineLogger = () => undefined,
): Promise<OcrEngine> {
  const worker = await createWorker(language, OEM.LSTM_ONLY, {
    workerPath: OCR_DATA_WORKER_URL,
    corePath: OCR_DATA_CORE_URL,
    langPath: OCR_DATA_LANG_URL,
    logger: (message: LoggerMessage) => onLogger({ status: message.status, progress: message.progress }),
  });
  return {
    async recognize(image: OcrImageInput): Promise<OcrRecognizeResult> {
      const { data } = await worker.recognize(image, {}, { blocks: true });
      return { text: cleanOcrText(data.text ?? ''), words: extractWords(data.blocks) };
    },
    async terminate(): Promise<void> {
      await worker.terminate();
    },
  };
}

/**
 * Flatten Tesseract's block/paragraph/line/word tree into the word boxes
 * the PDF text layer needs. Words with no text (spaces, artifacts) are
 * dropped; the rest keep their image-pixel boxes and confidence.
 */
export function extractWords(
  blocks: ReadonlyArray<{
    paragraphs?: ReadonlyArray<{
      lines?: ReadonlyArray<{
        words?: ReadonlyArray<{
          text?: string;
          confidence?: number;
          bbox?: { x0: number; y0: number; x1: number; y1: number };
        }>;
      }>;
    }>;
  }> | null | undefined,
): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? '').trim();
          const bbox = word.bbox;
          if (!text || !bbox) continue;
          words.push({
            text,
            x0: bbox.x0,
            y0: bbox.y0,
            x1: bbox.x1,
            y1: bbox.y1,
            confidence: typeof word.confidence === 'number' ? word.confidence : 0,
          });
        }
      }
    }
  }
  return words;
}
