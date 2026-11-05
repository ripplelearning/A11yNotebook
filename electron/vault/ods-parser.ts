import type { Element as XmlElement } from '@xmldom/xmldom';
import {
  childElements,
  descendants,
  paragraphText,
  parseXml,
} from './office-xml';
import { readZipEntries, type ZipEntry } from './zip-archive';
import {
  columnLabel,
  emptyCell,
  type SpreadsheetCell,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from '../../src/shared/spreadsheet';

const LABEL = 'ODS';
const MAX_SHEETS = 100;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 500_000;

function invalid(message: string): never {
  throw new Error(message);
}

function attr(element: XmlElement, name: string): string {
  return element.getAttribute(name) || '';
}

function repeatCount(element: XmlElement, name: string, max: number): number {
  const raw = Number(element.getAttribute(name));
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, max);
}

function cellText(cell: XmlElement): string {
  const paragraphs = childElements(cell, 'p');
  return paragraphs.map(paragraphText).join('\n');
}

interface OdsState {
  cells: number;
  truncated: boolean;
  truncationReason?: string;
}

function parseCell(
  cell: XmlElement,
  column: number,
  row: number,
  sheet: SpreadsheetSheet,
  state: OdsState,
): void {
  const valueType = attr(cell, 'office:value-type');
  const formulaAttr = attr(cell, 'table:formula');
  const formula = formulaAttr ? formulaAttr.replace(/^[^:]*:=/, '') : undefined;
  const result: SpreadsheetCell = { text: cellText(cell) };
  if (formula) result.formula = formula;
  const styleName = attr(cell, 'table:style-name');
  if (styleName) result.styleName = styleName;

  if (valueType === 'float' || valueType === 'percentage' || valueType === 'currency') {
    const numeric = Number(attr(cell, 'office:value'));
    if (!Number.isNaN(numeric)) {
      result.value = numeric;
      if (result.text === '') result.text = String(numeric);
    }
  } else if (valueType === 'boolean') {
    const booleanValue = attr(cell, 'office:boolean-value') === 'true';
    result.value = booleanValue;
    result.text = booleanValue ? 'TRUE' : 'FALSE';
  } else if (valueType === 'date') {
    const dateValue = attr(cell, 'office:date-value');
    if (dateValue) {
      const datePart = dateValue.slice(0, 10);
      const timePart = dateValue.length > 11 ? dateValue.slice(11, 16) : '';
      result.text = timePart && timePart !== '00:00' ? `${datePart} ${timePart}` : datePart;
    }
  } else if (valueType === 'time') {
    result.text = attr(cell, 'office:time-value') || result.text;
  }

  const columnSpan = repeatCount(cell, 'table:number-columns-spanned', MAX_COLUMNS);
  const rowSpan = repeatCount(cell, 'table:number-rows-spanned', MAX_ROWS);
  if (columnSpan > 1 || rowSpan > 1) {
    const endColumn = column + columnSpan - 1;
    const endRow = row + rowSpan - 1;
    sheet.mergedCells.push(`${columnLabel(column)}${row + 1}:${columnLabel(endColumn)}${endRow + 1}`);
  }

  const repeats = repeatCount(cell, 'table:number-columns-repeated', MAX_COLUMNS - column);
  for (let offset = 0; offset < repeats; offset += 1) {
    const targetColumn = column + offset;
    if (targetColumn >= MAX_COLUMNS) {
      state.truncated = true;
      state.truncationReason = `The spreadsheet was truncated at ${MAX_COLUMNS} columns.`;
      return;
    }
    const targetRow = sheet.rows[row];
    while (targetRow.length <= targetColumn) targetRow.push(emptyCell());
    // Repeated cells share the value; only the first carries a merge.
    targetRow[targetColumn] = offset === 0 ? result : { text: result.text, value: result.value };
    state.cells += 1;
    if (state.cells > MAX_CELLS) {
      state.truncated = true;
      state.truncationReason = `The spreadsheet was truncated at ${MAX_CELLS.toLocaleString()} cells.`;
      return;
    }
  }
}

function parseTable(
  table: XmlElement,
  name: string,
  columnWidths: Map<string, number>,
  state: OdsState,
): SpreadsheetSheet {
  const sheet: SpreadsheetSheet = { name, rows: [], mergedCells: [], columnWidths: [] };
  const columns = childElements(table, 'table-column');
  columns.forEach((columnElement, index) => {
    const styleName = columnElement.getAttribute('table:style-name') || '';
    const width = columnWidths.get(styleName);
    if (width !== undefined) sheet.columnWidths.push({ index, width });
  });

  let rowIndex = 0;
  for (const rowElement of childElements(table, 'table-row')) {
    const rowRepeats = repeatCount(rowElement, 'table:number-rows-repeated', MAX_ROWS - rowIndex);
    for (let repeat = 0; repeat < rowRepeats; repeat += 1) {
      if (rowIndex >= MAX_ROWS) {
        state.truncated = true;
        state.truncationReason = `The spreadsheet was truncated at ${MAX_ROWS.toLocaleString()} rows.`;
        break;
      }
      sheet.rows.push([]);
      let columnIndex = 0;
      for (const cellElement of childElements(rowElement, 'table-cell')) {
        if (state.truncated) break;
        parseCell(cellElement, columnIndex, rowIndex, sheet, state);
        columnIndex += repeatCount(cellElement, 'table:number-columns-repeated', MAX_COLUMNS - columnIndex);
      }
      for (const cellElement of childElements(rowElement, 'covered-table-cell')) {
        if (state.truncated) break;
        columnIndex += repeatCount(cellElement, 'table:number-columns-repeated', MAX_COLUMNS - columnIndex);
      }
      rowIndex += 1;
      if (state.truncated) break;
    }
    if (state.truncated) break;
  }

  // Trim trailing empty rows and columns.
  let lastRow = sheet.rows.length;
  while (lastRow > 0 && sheet.rows[lastRow - 1].every((cell) => cell.text === '')) lastRow -= 1;
  let lastColumn = 0;
  for (let index = 0; index < lastRow; index += 1) {
    for (let column = 0; column < sheet.rows[index].length; column += 1) {
      if (sheet.rows[index][column].text !== '') lastColumn = Math.max(lastColumn, column + 1);
    }
  }
  sheet.rows = sheet.rows.slice(0, lastRow).map((row) => row.slice(0, lastColumn));
  return sheet;
}

function parseColumnWidths(entries: Map<string, ZipEntry>): Map<string, number> {
  const widths = new Map<string, number>();
  const document = parseXml(entries, 'content.xml', LABEL);
  if (!document || !document.documentElement) return widths;
  const styles = descendants(document.documentElement, 'automatic-styles', LABEL, 10)[0];
  if (!styles) return widths;
  for (const style of childElements(styles, 'style')) {
    if (style.getAttribute('style:family') !== 'table-column') continue;
    const name = style.getAttribute('style:name') || '';
    const properties = childElements(style, 'table-column-properties')[0];
    const widthAttr = properties?.getAttribute('style:column-width') || '';
    const match = /^([\d.]+)cm$/.exec(widthAttr);
    if (name && match) widths.set(name, Number(match[1]));
  }
  return widths;
}

export function parseOdsWorkbook(bytes: Buffer): SpreadsheetWorkbook {
  const entries = readZipEntries(bytes, LABEL);
  const document = parseXml(entries, 'content.xml', LABEL);
  if (!document || !document.documentElement) invalid(`The ${LABEL} part content.xml is missing.`);
  const body = descendants(document.documentElement, 'body', LABEL, 10)[0];
  const spreadsheet = body ? childElements(body, 'spreadsheet')[0] : undefined;
  if (!spreadsheet) invalid(`The ${LABEL} file contains no spreadsheet.`);
  const tables = childElements(spreadsheet, 'table');
  if (!tables.length) invalid(`The ${LABEL} workbook contains no sheets.`);
  if (tables.length > MAX_SHEETS) invalid(`The ${LABEL} workbook exceeds the ${MAX_SHEETS} sheet limit.`);

  const columnWidths = parseColumnWidths(entries);
  const state: OdsState = { cells: 0, truncated: false };
  const workbook: SpreadsheetWorkbook = {
    sourceFormat: 'ods',
    sheets: [],
    unsupportedFeatures: [],
    truncated: false,
  };
  for (const table of tables) {
    const name = table.getAttribute('table:name') || 'Sheet';
    workbook.sheets.push(parseTable(table, name, columnWidths, state));
    if (state.truncated) break;
  }
  workbook.truncated = state.truncated;
  if (state.truncationReason) workbook.truncationReason = state.truncationReason;
  return workbook;
}
