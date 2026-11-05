import type { Element as XmlElement } from '@xmldom/xmldom';
import {
  childElements,
  descendants,
  elementText,
  parseXml,
} from './office-xml';
import { readZipEntries, type ZipEntry } from './zip-archive';
import {
  emptyCell,
  parseCellReference,
  type SpreadsheetCell,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from '../../src/shared/spreadsheet';

const LABEL = 'XLSX';
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const MAX_SHEETS = 100;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 500_000;
// Built-in Excel number-format ids that render as dates or times.
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function invalid(message: string): never {
  throw new Error(message);
}

function attr(element: XmlElement, name: string): string {
  return element.getAttribute(name) || '';
}

function relId(element: XmlElement): string {
  return element.getAttributeNS(RELS_NS, 'id') || element.getAttribute('r:id') || '';
}

/** Excel serial date (1 = 1900-01-01) to a UTC date. Serial 60 is Excel's nonexistent 1900-02-29; it renders as 1900-02-28. */
function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function formatSerialDate(serial: number): string {
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

function isDateFormat(formatCode: string | undefined, formatId: number): boolean {
  if (DATE_FORMAT_IDS.has(formatId)) return true;
  if (!formatCode) return false;
  // Strip quoted literals and bracket sections such as [$-409] or [Red].
  const code = formatCode
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(code);
}

interface XlsxStyles {
  /** numFmtId per cellXfs index. */
  formatIds: number[];
  /** Custom format codes by numFmtId. */
  customFormats: Map<number, string>;
}

function parseStyles(entries: Map<string, ZipEntry>): XlsxStyles {
  const styles: XlsxStyles = { formatIds: [], customFormats: new Map() };
  const document = parseXml(entries, 'xl/styles.xml', LABEL, false);
  if (!document || !document.documentElement) return styles;
  for (const numFmt of descendants(document.documentElement, 'numFmt', LABEL)) {
    const id = Number(numFmt.getAttribute('numFmtId'));
    const code = numFmt.getAttribute('formatCode');
    if (Number.isInteger(id) && code) styles.customFormats.set(id, code);
  }
  const cellXfs = descendants(document.documentElement, 'cellXfs', LABEL, 10)[0];
  if (!cellXfs) return styles;
  for (const xf of childElements(cellXfs, 'xf')) {
    const numFmtId = Number(xf.getAttribute('numFmtId'));
    styles.formatIds.push(Number.isInteger(numFmtId) ? numFmtId : 0);
  }
  return styles;
}

function parseSharedStrings(entries: Map<string, ZipEntry>): string[] {
  const document = parseXml(entries, 'xl/sharedStrings.xml', LABEL, false);
  if (!document || !document.documentElement) return [];
  const strings: string[] = [];
  for (const si of childElements(document.documentElement, 'si')) {
    let text = '';
    for (const t of descendants(si, 't', LABEL)) text += t.textContent || '';
    strings.push(text);
  }
  return strings;
}

function parseCell(
  cell: XmlElement,
  sharedStrings: string[],
  styles: XlsxStyles,
): { column: number; value: SpreadsheetCell } | undefined {
  const reference = attr(cell, 'r');
  const parsed = reference ? parseCellReference(reference) : undefined;
  const column = parsed ? parsed.column : -1;
  const type = attr(cell, 't');
  const styleAttr = attr(cell, 's');
  const styleIndex = styleAttr ? Number(styleAttr) : undefined;
  const formulaElement = childElements(cell, 'f')[0];
  const formula = formulaElement ? elementText(formulaElement) : undefined;
  const valueElement = childElements(cell, 'v')[0];
  const rawValue = valueElement ? elementText(valueElement) : '';

  const result: SpreadsheetCell = { text: '' };
  if (formula !== undefined && formula !== '') result.formula = formula;
  if (styleIndex !== undefined && Number.isInteger(styleIndex)) result.styleIndex = styleIndex;

  if (type === 'inlineStr') {
    const isElement = childElements(cell, 'is')[0];
    let text = '';
    if (isElement) for (const t of descendants(isElement, 't', LABEL)) text += t.textContent || '';
    result.text = text;
  } else if (type === 's') {
    const index = Number(rawValue);
    result.text = Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : '';
  } else if (type === 'str') {
    result.text = rawValue;
  } else if (type === 'b') {
    const booleanValue = rawValue === '1' || rawValue.toLowerCase() === 'true';
    result.value = booleanValue;
    result.text = booleanValue ? 'TRUE' : 'FALSE';
  } else if (type === 'e') {
    result.text = rawValue;
  } else {
    if (rawValue === '') return column >= 0 ? { column, value: result } : undefined;
    const numeric = Number(rawValue);
    if (Number.isNaN(numeric)) {
      result.text = rawValue;
    } else {
      result.value = numeric;
      const formatId = result.styleIndex !== undefined ? styles.formatIds[result.styleIndex] ?? 0 : 0;
      const formatCode = styles.customFormats.get(formatId);
      result.text =
        numeric >= 0 && isDateFormat(formatCode, formatId) ? formatSerialDate(numeric) : String(numeric);
    }
  }
  return column >= 0 ? { column, value: result } : undefined;
}

function parseSheet(
  entries: Map<string, ZipEntry>,
  partPath: string,
  name: string,
  sharedStrings: string[],
  styles: XlsxStyles,
  state: { cells: number; truncated: boolean; truncationReason?: string },
): SpreadsheetSheet {
  const sheet: SpreadsheetSheet = { name, rows: [], mergedCells: [], columnWidths: [] };
  const document = parseXml(entries, partPath, LABEL);
  if (!document || !document.documentElement) invalid(`The ${LABEL} part ${partPath} is missing.`);
  const root = document.documentElement;

  const cols = descendants(root, 'cols', LABEL, 10)[0];
  if (cols) {
    for (const col of childElements(cols, 'col')) {
      const min = Number(col.getAttribute('min'));
      const width = Number(col.getAttribute('width'));
      if (Number.isInteger(min) && min >= 1 && Number.isFinite(width)) {
        sheet.columnWidths.push({ index: min - 1, width });
      }
    }
  }

  const mergeCells = descendants(root, 'mergeCells', LABEL, 10)[0];
  if (mergeCells) {
    for (const merge of childElements(mergeCells, 'mergeCell')) {
      const ref = merge.getAttribute('ref');
      if (ref) sheet.mergedCells.push(ref);
    }
  }

  const sheetData = descendants(root, 'sheetData', LABEL, 10)[0];
  if (!sheetData) return sheet;
  const rows: SpreadsheetCell[][] = [];
  let expectedRow = 0;
  for (const rowElement of childElements(sheetData, 'row')) {
    const rowAttr = rowElement.getAttribute('r');
    const rowIndex = rowAttr ? Number(rowAttr) - 1 : expectedRow;
    if (!Number.isInteger(rowIndex) || rowIndex < 0) continue;
    if (rowIndex >= MAX_ROWS) {
      state.truncated = true;
      state.truncationReason = `The spreadsheet was truncated at ${MAX_ROWS.toLocaleString()} rows.`;
      break;
    }
    while (rows.length < rowIndex) rows.push([]);
    const row: SpreadsheetCell[] = [];
    for (const cellElement of childElements(rowElement, 'c')) {
      const parsed = parseCell(cellElement, sharedStrings, styles);
      if (!parsed) continue;
      const { column, value } = parsed;
      if (column < 0 || column >= MAX_COLUMNS) {
        state.truncated = true;
        state.truncationReason = `The spreadsheet was truncated at ${MAX_COLUMNS} columns.`;
        continue;
      }
      while (row.length < column) row.push(emptyCell());
      row[column] = value;
      state.cells += 1;
      if (state.cells > MAX_CELLS) {
        state.truncated = true;
        state.truncationReason = `The spreadsheet was truncated at ${MAX_CELLS.toLocaleString()} cells.`;
        break;
      }
    }
    rows[rowIndex] = row;
    expectedRow = rowIndex + 1;
    if (state.truncated) break;
  }

  // Trim trailing empty rows and columns.
  let lastRow = rows.length;
  while (lastRow > 0 && rows[lastRow - 1].every((cell) => cell.text === '')) lastRow -= 1;
  let lastColumn = 0;
  for (let index = 0; index < lastRow; index += 1) {
    for (let column = 0; column < rows[index].length; column += 1) {
      if (rows[index][column].text !== '') lastColumn = Math.max(lastColumn, column + 1);
    }
  }
  sheet.rows = rows.slice(0, lastRow).map((row) => row.slice(0, lastColumn));
  return sheet;
}

/** Ordered sheet names and worksheet part paths for a workbook's entries. */
export function xlsxSheetParts(entries: Map<string, ZipEntry>): Array<{ name: string; partPath: string }> {
  const workbookDocument = parseXml(entries, 'xl/workbook.xml', LABEL);
  if (!workbookDocument || !workbookDocument.documentElement)
    invalid(`The ${LABEL} part xl/workbook.xml is missing.`);

  const relsDocument = parseXml(entries, 'xl/_rels/workbook.xml.rels', LABEL, false);
  const relTargets = new Map<string, string>();
  if (relsDocument && relsDocument.documentElement) {
    for (const rel of childElements(relsDocument.documentElement, 'Relationship')) {
      if (rel.getAttribute('Type') !== WORKSHEET_TYPE) continue;
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) relTargets.set(id, target.replace(/^\//, '').replace(/^xl\//, ''));
    }
  }

  const sheetsElement = descendants(workbookDocument.documentElement, 'sheets', LABEL, 10)[0];
  const sheetElements = sheetsElement ? childElements(sheetsElement, 'sheet') : [];
  if (!sheetElements.length) invalid(`The ${LABEL} workbook contains no sheets.`);
  if (sheetElements.length > MAX_SHEETS) invalid(`The ${LABEL} workbook exceeds the ${MAX_SHEETS} sheet limit.`);

  const usedPartPaths = new Set<string>();
  const parts: Array<{ name: string; partPath: string }> = [];
  sheetElements.forEach((sheetElement, index) => {
    const name = sheetElement.getAttribute('name') || 'Sheet';
    const id = relId(sheetElement);
    const target = id ? relTargets.get(id) : undefined;
    // Fall back to the conventional part order when relationships are absent.
    const partPath = target ? `xl/${target}` : `xl/worksheets/sheet${index + 1}.xml`;
    if (usedPartPaths.has(partPath)) invalid(`The ${LABEL} workbook lists the same worksheet twice.`);
    usedPartPaths.add(partPath);
    if (!entries.has(partPath)) invalid(`The ${LABEL} part ${partPath} is missing.`);
    parts.push({ name, partPath });
  });
  return parts;
}

export function parseXlsxWorkbook(bytes: Buffer): SpreadsheetWorkbook {
  const entries = readZipEntries(bytes, LABEL);
  const parts = xlsxSheetParts(entries);
  const sharedStrings = parseSharedStrings(entries);
  const styles = parseStyles(entries);
  const state = { cells: 0, truncated: false, truncationReason: undefined as string | undefined };
  const workbook: SpreadsheetWorkbook = {
    sourceFormat: 'xlsx',
    sheets: [],
    unsupportedFeatures: [],
    truncated: false,
  };
  for (const part of parts) {
    workbook.sheets.push(parseSheet(entries, part.partPath, part.name, sharedStrings, styles, state));
    if (state.truncated) break;
  }
  workbook.truncated = state.truncated;
  if (state.truncationReason) workbook.truncationReason = state.truncationReason;
  return workbook;
}
