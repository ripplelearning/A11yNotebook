import type { SpreadsheetWorkbook } from '../../src/shared/spreadsheet';

function quoteField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Serialize the first sheet as CSV text. */
export function writeCsvWorkbook(workbook: SpreadsheetWorkbook): string {
  if (workbook.sourceFormat !== 'csv') throw new Error('CSV saving requires a csv workbook.');
  const sheet = workbook.sheets[0];
  if (!sheet) return '';
  return sheet.rows.map((row) => row.map((cell) => quoteField(cell.text)).join(',')).join('\n') + '\n';
}
