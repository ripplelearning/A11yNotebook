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
