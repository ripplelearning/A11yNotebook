// Shared spreadsheet model: workbooks read from XLSX, ODS, CSV, and XLS,
// edited in the attachment preview, and saved back to the same file.
// The model carries just enough of the original file (per-cell style
// indexes, merged ranges, column widths) for the writers to save back
// without dropping the spreadsheet's structure.
export interface SpreadsheetCell {
  /** Display text: the formula's cached value, the formatted number or date, or the raw text. */
  text: string;
  /** Raw numeric or boolean value when the cell holds one. */
  value?: number | boolean;
  /** Formula text without the leading '=', when the cell holds a formula. */
  formula?: string;
  /** Original cell style index, preserved on save. */
  styleIndex?: number;
  /** Original ODS cell style name, preserved on save. */
  styleName?: string;
}

export interface SpreadsheetSheet {
  name: string;
  /** Rectangular grid; trailing empty rows and columns are trimmed on read. */
  rows: SpreadsheetCell[][];
  /** Merged ranges as A1 references, e.g. 'A1:B2'. */
  mergedCells: string[];
  columnWidths: Array<{ index: number; width: number }>;
}

export type SpreadsheetSourceFormat = 'xlsx' | 'ods' | 'csv' | 'xls';

export interface SpreadsheetWorkbook {
  sourceFormat: SpreadsheetSourceFormat;
  sheets: SpreadsheetSheet[];
  unsupportedFeatures: string[];
  truncated: boolean;
  truncationReason?: string;
}

export function emptyCell(): SpreadsheetCell {
  return { text: '' };
}

/** 0-based column index to spreadsheet letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLabel(index: number): string {
  let label = '';
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

/** Spreadsheet letters to a 0-based column index: A -> 0, Z -> 25, AA -> 26. */
export function columnIndex(label: string): number {
  let index = 0;
  for (const character of label.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Split an A1 cell reference such as 'B2' into a 0-based column and row. */
export function parseCellReference(reference: string): { column: number; row: number } | undefined {
  const match = /^([A-Za-z]+)(\d+)$/.exec(reference);
  if (!match) return undefined;
  return { column: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

/** Excel serial date (1 = 1900-01-01) to a UTC date. Serial 60 is Excel's nonexistent 1900-02-29; it renders as 1900-02-28. */
export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

export function formatSerialDate(serial: number): string {
  const date = serialToDate(serial);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hasTime = Math.abs(serial - Math.floor(serial)) > 0.0000001;
  if (!hasTime) return `${year}-${month}-${day}`;
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function dateTextToSerial(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const date = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  );
  const serial = date / 86400000 + 25569;
  return Number.isFinite(serial) && serial >= 0 ? serial : undefined;
}

/**
 * Apply a typed edit to a cell. Editing replaces any formula with the
 * typed value. Numbers and TRUE/FALSE become typed values; a
 * YYYY-MM-DD date typed into a cell that already held a date keeps the
 * cell a date (serial value plus its style) instead of becoming text.
 */
export function applyCellEdit(cell: SpreadsheetCell, text: string): SpreadsheetCell {
  const trimmed = text.trim();
  const next: SpreadsheetCell = { text };
  if (cell.styleIndex !== undefined) next.styleIndex = cell.styleIndex;
  if (cell.styleName !== undefined) next.styleName = cell.styleName;
  if (trimmed === '') return next;
  if (/^(TRUE|FALSE)$/i.test(trimmed)) {
    next.value = trimmed.toUpperCase() === 'TRUE';
    next.text = next.value ? 'TRUE' : 'FALSE';
    return next;
  }
  const numeric = Number(trimmed);
  if (trimmed !== '' && !Number.isNaN(numeric)) {
    next.value = numeric;
    return next;
  }
  if (typeof cell.value === 'number' && cell.text !== String(cell.value)) {
    const serial = dateTextToSerial(trimmed);
    if (serial !== undefined) {
      next.value = serial;
      next.text = formatSerialDate(serial);
      return next;
    }
  }
  return next;
}
