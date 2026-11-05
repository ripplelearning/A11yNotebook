import { parseCsv } from '../../src/shared/attachments';
import type { SpreadsheetWorkbook } from '../../src/shared/spreadsheet';

const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 500_000;

/** CSV text as a single-sheet workbook. Every cell is plain text. */
export function parseCsvWorkbook(text: string, sheetName: string): SpreadsheetWorkbook {
  const parsed = parseCsv(text);
  const workbook: SpreadsheetWorkbook = {
    sourceFormat: 'csv',
    sheets: [{ name: sheetName, rows: [], mergedCells: [], columnWidths: [] }],
    unsupportedFeatures: [],
    truncated: false,
  };
  const sheet = workbook.sheets[0];
  let cells = 0;
  for (const sourceRow of parsed) {
    if (sheet.rows.length >= MAX_ROWS) {
      workbook.truncated = true;
      workbook.truncationReason = `The spreadsheet was truncated at ${MAX_ROWS.toLocaleString()} rows.`;
      break;
    }
    const row = sourceRow.slice(0, MAX_COLUMNS).map((text) => ({ text }));
    if (sourceRow.length > MAX_COLUMNS && !workbook.truncated) {
      workbook.truncated = true;
      workbook.truncationReason = `The spreadsheet was truncated at ${MAX_COLUMNS} columns.`;
    }
    cells += row.length;
    if (cells > MAX_CELLS) {
      workbook.truncated = true;
      workbook.truncationReason = `The spreadsheet was truncated at ${MAX_CELLS.toLocaleString()} cells.`;
      break;
    }
    sheet.rows.push(row);
  }
  let lastRow = sheet.rows.length;
  while (lastRow > 0 && sheet.rows[lastRow - 1].every((cell) => cell.text === '')) lastRow -= 1;
  let lastColumn = 0;
  for (let index = 0; index < lastRow; index += 1) {
    for (let column = 0; column < sheet.rows[index].length; column += 1) {
      if (sheet.rows[index][column].text !== '') lastColumn = Math.max(lastColumn, column + 1);
    }
  }
  sheet.rows = sheet.rows.slice(0, lastRow).map((row) => row.slice(0, lastColumn));
  return workbook;
}
