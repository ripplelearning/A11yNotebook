/**
 * Alius records: one `.alius` file per shortcut in a notebook, shown in the
 * Notes and Files grid with Type "Alius". The file is JSON holding the
 * absolute path of the original file. The original stays where it is and
 * is never copied; opening the Alius opens the original in the app's
 * reader or editor, and editing it saves back to the original.
 */

/** The extension of an Alius record file. */
export const ALIUS_FILE_EXTENSION = '.alius';

/** True when the path is an Alius record file. */
export function isAliusPath(value: string): boolean {
  return value.toLowerCase().endsWith(ALIUS_FILE_EXTENSION);
}

/** The contents of an Alius record file. */
export interface AliusRecord {
  version: 1;
  target: string;
}

/** Serialize an Alius record file: JSON with the original's absolute path. */
export function formatAliusFile(target: string): string {
  return `${JSON.stringify({ version: 1, target: target.trim() } satisfies AliusRecord)}\n`;
}

/**
 * Read the target path back out of an Alius record file. Returns null when
 * the file is not a valid record (bad JSON, wrong version, or no target).
 * A UTF-8 byte-order mark at the start of the file is tolerated.
 */
export function parseAliusTarget(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) return null;
  const target = record.target;
  if (typeof target !== 'string' || !target.trim()) return null;
  return target.trim();
}

const ILLEGAL_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/gu;

/**
 * Turn a source file name into an Alius record file name. The record keeps
 * the source file's full name (including its extension) so the grid shows
 * what the original is, with `.alius` appended. Illegal file-name
 * characters become '-', surrounding whitespace is trimmed, and an empty
 * name falls back to "Alius".
 */
export function aliusFileName(sourceName: string): string {
  const stem = sourceName
    .replace(ILLEGAL_FILE_NAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return `${stem || 'Alius'}${ALIUS_FILE_EXTENSION}`;
}

/** The two ways an import can store a file: a managed copy, or an Alius shortcut to the original. */
export type ImportChoice = 'copy' | 'alius';

/**
 * A picked file waiting for the user to choose copy or Alius. The main
 * process validated the source and computed the destination name; nothing
 * is written until the user chooses. Feature 2 (paste) reuses this shape
 * for pasted files.
 */
export interface ImportPending {
  /** Absolute path of a file outside the library, or a library-relative path for an in-library file. */
  source: string;
  /** True when `source` is a library-relative path instead of an absolute path. */
  sourceInLibrary: boolean;
  /** Notebook the copy or Alius record goes into ('' for the library root). */
  notebookPath: string;
  /** File name the copy would take (converted extension for RTF/DOC sources). */
  destinationName: string;
  /** File name shown in the prompt. */
  sourceName: string;
  /** True when whole-library encryption is on: the original itself is never encrypted. */
  libraryEncrypted: boolean;
}
