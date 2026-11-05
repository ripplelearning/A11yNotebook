import { readZipEntries } from './zip-archive';
import { escapeXml, writeZipEntries } from './zip-write';
import {
  formatSerialDate,
  parseCellReference,
  type SpreadsheetCell,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from '../../src/shared/spreadsheet';

function invalid(message: string): never {
  throw new Error(message);
}

function textParagraphs(text: string): string {
  return text
    .split('\n')
    .map((line) => `<text:p>${escapeXml(line)}</text:p>`)
    .join('');
}

function coveredPositions(sheet: SpreadsheetSheet): Set<string> {
  const covered = new Set<string>();
  for (const range of sheet.mergedCells) {
    const [start, end] = range.split(':');
    const from = parseCellReference(start);
    const to = end ? parseCellReference(end) : from;
    if (!from || !to) continue;
    for (let row = from.row; row <= to.row; row += 1) {
      for (let column = from.column; column <= to.column; column += 1) {
        if (row !== from.row || column !== from.column) covered.add(`${row}:${column}`);
      }
    }
  }
  return covered;
}

function spanOf(sheet: SpreadsheetSheet, column: number, row: number): { columns: number; rows: number } {
  for (const range of sheet.mergedCells) {
    const [start, end] = range.split(':');
    const from = parseCellReference(start);
    const to = end ? parseCellReference(end) : from;
    if (!from || !to) continue;
    if (from.column === column && from.row === row) {
      return { columns: to.column - from.column + 1, rows: to.row - from.row + 1 };
    }
  }
  return { columns: 1, rows: 1 };
}

function cellXml(cell: SpreadsheetCell, sheet: SpreadsheetSheet, column: number, row: number): string {
  const style = cell.styleName ? ` table:style-name="${escapeXml(cell.styleName)}"` : '';
  const span = spanOf(sheet, column, row);
  const spanAttrs =
    (span.columns > 1 ? ` table:number-columns-spanned="${span.columns}"` : '') +
    (span.rows > 1 ? ` table:number-rows-spanned="${span.rows}"` : '');
  const formula = cell.formula ? ` table:formula="of:=${escapeXml(cell.formula)}"` : '';
  if (typeof cell.value === 'boolean') {
    return `<table:table-cell${style}${spanAttrs}${formula} office:value-type="boolean" office:boolean-value="${cell.value ? 'true' : 'false'}">${textParagraphs(cell.text)}</table:table-cell>`;
  }
  if (typeof cell.value === 'number') {
    // A numeric cell whose display text is not the number itself holds a date.
    if (cell.text !== String(cell.value)) {
      const dateValue = formatSerialDate(cell.value).slice(0, 10);
      return `<table:table-cell${style}${spanAttrs}${formula} office:value-type="date" office:date-value="${dateValue}">${textParagraphs(cell.text)}</table:table-cell>`;
    }
    return `<table:table-cell${style}${spanAttrs}${formula} office:value-type="float" office:value="${cell.value}">${textParagraphs(cell.text)}</table:table-cell>`;
  }
  if (cell.text === '') return `<table:table-cell${style}${spanAttrs}/>`;
  return `<table:table-cell${style}${spanAttrs}${formula} office:value-type="string">${textParagraphs(cell.text)}</table:table-cell>`;
}

function tableXml(sheet: SpreadsheetSheet): string {
  const covered = coveredPositions(sheet);
  const columnCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const parts: string[] = [];
  parts.push(`<table:table table:name="${escapeXml(sheet.name)}">`);
  for (let column = 0; column < columnCount; column += 1) {
    const width = sheet.columnWidths.find((entry) => entry.index === column);
    parts.push(
      width
        ? `<table:table-column table:style-name="a11y-col-${column + 1}"/>`
        : '<table:table-column/>',
    );
  }
  sheet.rows.forEach((row, rowIndex) => {
    parts.push('<table:table-row>');
    row.forEach((cell, columnIndex) => {
      if (covered.has(`${rowIndex}:${columnIndex}`)) {
        parts.push('<table:covered-table-cell/>');
      } else {
        parts.push(cellXml(cell, sheet, columnIndex, rowIndex));
      }
    });
    parts.push('</table:table-row>');
  });
  parts.push('</table:table>');
  return parts.join('');
}

function columnStylesXml(sheet: SpreadsheetSheet): string {
  return sheet.columnWidths
    .map(
      ({ index, width }) =>
        `<style:style style:name="a11y-col-${index + 1}" style:family="table-column"><style:table-column-properties style:column-width="${width}cm"/></style:style>`,
    )
    .join('');
}

/**
 * Save a workbook back into its .ods package: only content.xml changes.
 * The original automatic styles, settings, and other parts pass through
 * untouched; the spreadsheet tables are regenerated from the model and
 * column-width styles are appended to the automatic styles.
 */
export function writeOdsWorkbook(originalBytes: Buffer, workbook: SpreadsheetWorkbook): Buffer {
  if (workbook.sourceFormat !== 'ods') invalid('ODS saving requires an ods workbook.');
  const entries = readZipEntries(originalBytes, 'ODS');
  const contentEntry = entries.get('content.xml');
  if (!contentEntry) invalid('The ODS part content.xml is missing.');
  const content = contentEntry.bytes.toString('utf8');
  const spreadsheetStart = content.indexOf('<office:spreadsheet');
  const spreadsheetEnd = content.indexOf('</office:spreadsheet>');
  if (spreadsheetStart < 0 || spreadsheetEnd < 0) invalid('The ODS file contains no spreadsheet.');
  const spreadsheetOpenEnd = content.indexOf('>', spreadsheetStart);
  if (spreadsheetOpenEnd < 0 || spreadsheetOpenEnd > spreadsheetEnd)
    invalid('The ODS spreadsheet element is malformed.');
  const tables = workbook.sheets.map(tableXml).join('');
  let updated =
    content.slice(0, spreadsheetOpenEnd + 1) + tables + content.slice(spreadsheetEnd);
  const stylesClose = updated.indexOf('</office:automatic-styles>');
  const columnStyles = workbook.sheets.map(columnStylesXml).join('');
  if (stylesClose >= 0 && columnStyles) {
    updated = updated.slice(0, stylesClose) + columnStyles + updated.slice(stylesClose);
  }
  entries.set('content.xml', { path: 'content.xml', bytes: Buffer.from(updated, 'utf8') });
  return writeZipEntries(entries);
}
