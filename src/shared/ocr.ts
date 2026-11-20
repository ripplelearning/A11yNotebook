/**
 * On-device OCR ("OCR this file") for open ePubs and PDFs.
 *
 * The recognition itself runs entirely on this computer with Tesseract.js
 * (see src/renderer/features/previews/ocr-engine.ts): no page image or
 * text ever leaves the device. Language data is bundled for English and
 * downloaded once, on demand, for other languages (see
 * electron/ocr-runtime.ts); after that the feature works offline.
 *
 * This module holds only the shared shapes and pure helpers: the engine,
 * the image extraction, and the file writers live in the renderer, and
 * the privileged file writes live in the main process.
 */

/** The largest file OCR accepts, matching the reader's preview cap. */
export const OCR_MAX_FILE_BYTES = 40 * 1024 * 1024;

/**
 * The `ocr-data:` URLs the renderer hands to Tesseract.js (see
 * electron/ocr-runtime.ts): the worker script, the directory holding the
 * WebAssembly core, and the directory holding language data. All three
 * resolve to files on this computer — no network is involved.
 */
export const OCR_DATA_WORKER_URL = 'ocr-data://ocr/runtime/worker.min.js';
export const OCR_DATA_CORE_URL = 'ocr-data://ocr/runtime';
export const OCR_DATA_LANG_URL = 'ocr-data://ocr/lang';

/** One recognized word with its bounding box in image pixels. */
export interface OcrWord {
  text: string;
  /** Left edge in image pixels. */
  x0: number;
  /** Top edge in image pixels. */
  y0: number;
  /** Right edge in image pixels. */
  x1: number;
  /** Bottom edge in image pixels. */
  y1: number;
  /** Tesseract confidence, 0–100. */
  confidence: number;
}

/**
 * The recognition result for one unit of the file: one PDF page or one
 * ePub section. `index` is the 0-based page or spine-section index.
 */
export interface OcrPageResult {
  index: number;
  text: string;
  words: OcrWord[];
  /** Width in pixels of the image that was recognized. */
  imageWidth: number;
  /** Height in pixels of the image that was recognized. */
  imageHeight: number;
}

/** Progress of a whole-file OCR run, for the progress bar and announcements. */
export interface OcrProgress {
  phase: 'preparing' | 'recognizing';
  /** Units fully recognized so far. */
  done: number;
  /** Total units in the file. */
  total: number;
  /** 0–1 progress within the unit currently being recognized. */
  pageProgress: number;
  /** Human-readable status, announced to screen readers. */
  status: string;
}

/** A language the OCR picker offers, with whether its data is on disk. */
export interface OcrLanguageStatus {
  code: string;
  name: string;
  /** True when the language data is bundled or already downloaded. */
  ready: boolean;
}

/**
 * Languages the picker offers. The code is the Tesseract language code;
 * the name is what the picker shows. English is listed first because its
 * data ships with the app, but it is never preselected: the user picks a
 * language every time.
 */
export const OCR_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'eng', name: 'English' },
  { code: 'spa', name: 'Spanish' },
  { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' },
  { code: 'ita', name: 'Italian' },
  { code: 'por', name: 'Portuguese' },
  { code: 'nld', name: 'Dutch' },
  { code: 'swe', name: 'Swedish' },
  { code: 'dan', name: 'Danish' },
  { code: 'nor', name: 'Norwegian' },
  { code: 'fin', name: 'Finnish' },
  { code: 'pol', name: 'Polish' },
  { code: 'rus', name: 'Russian' },
  { code: 'ukr', name: 'Ukrainian' },
  { code: 'ara', name: 'Arabic' },
  { code: 'heb', name: 'Hebrew' },
  { code: 'hin', name: 'Hindi' },
  { code: 'tha', name: 'Thai' },
  { code: 'vie', name: 'Vietnamese' },
  { code: 'tur', name: 'Turkish' },
  { code: 'chi_sim', name: 'Chinese (Simplified)' },
  { code: 'jpn', name: 'Japanese' },
  { code: 'kor', name: 'Korean' },
];

/** Languages whose trained data ships inside the app. */
export const OCR_BUNDLED_LANGUAGES: ReadonlyArray<string> = ['eng'];

/** The display name for a language code, or the code itself when unknown. */
export function ocrLanguageName(code: string): string {
  return OCR_LANGUAGES.find((language) => language.code === code)?.name ?? code;
}

/** True when the code is one the picker offers. */
export function isOcrLanguageCode(code: string): boolean {
  return OCR_LANGUAGES.some((language) => language.code === code);
}

/**
 * Tidy recognized text for display: drop form feeds, collapse runs of
 * blank lines, trim. Line breaks inside a paragraph are kept; the reader
 * renders them as flowing text.
 */
export function cleanOcrText(text: string): string {
  return text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split recognized text into paragraphs for writing back into an ePub
 * section: blank-line separated blocks, each with its lines joined by a
 * space.
 */
export function splitOcrParagraphs(text: string): string[] {
  return cleanOcrText(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Merge temporary OCR results into the reader's per-page/per-section
 * texts. Only units that had no extractable text gain OCR text: a page
 * or section that already reads keeps its own text, so OCR never
 * duplicates real text in the reader or in the saved file. Returns the
 * merged texts and how many units gained text.
 */
export function mergeOcrTexts(
  baseTexts: ReadonlyArray<string>,
  ocr: ReadonlyMap<number, string>,
): { texts: string[]; gained: number } {
  const texts = [...baseTexts];
  let gained = 0;
  for (const [index, text] of ocr) {
    if (index < 0 || index >= texts.length) continue;
    if (texts[index].trim()) continue;
    const cleaned = cleanOcrText(text);
    if (!cleaned) continue;
    texts[index] = cleaned;
    gained += 1;
  }
  return { texts, gained };
}

/**
 * The file name for the copy OCR saves for an Alius: the original is
 * never touched, so the recognized text goes into a new managed file in
 * the same notebook.
 */
export function ocrCopyFileName(fileName: string): string {
  const match = /^(.*)\.(pdf|epub)$/i.exec(fileName);
  if (!match) return `${fileName} (OCR)`;
  return `${match[1]} (OCR).${match[2].toLowerCase()}`;
}
