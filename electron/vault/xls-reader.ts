import { read as readWorkbook, utils, type WorkSheet } from 'xlsx';
import {
  columnLabel,
  emptyCell,
  type SpreadsheetCell,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from '../../src/shared/spreadsheet';

// Old binary .xls (BIFF) has no maintained in-house reader, so it is the
// one format read through SheetJS (community edition, Apache-2.0). Only
// the parsed cell values are used: every value is copied into the shared
// spreadsheet model as a plain string, number, or boolean, and the file
// itself is size-capped before parsing.
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 500_000;

function invalid(message: string): never {
  throw new Error(message);
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = value.getHours();
  const minutes = value.getMinutes();
  if (hours === 0 && minutes === 0 && value.getSeconds() === 0) return `${year}-${month}-${day}`;
  return `${year}-${month}-${day} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function readSheet(
  worksheet: WorkSheet,
  name: string,
  state: { cells: number; truncated: boolean; truncationReason?: string },
): SpreadsheetSheet {
  const sheet: SpreadsheetSheet = { name, rows: [], mergedCells: [], columnWidths: [] };
  const merges = Array.isArray(worksheet['!merges']) ? worksheet['!merges'] : [];
  for (const merge of merges) {
    const start = `${columnLabel(merge.s.c)}${merge.s.r + 1}`;
    const end = `${columnLabel(merge.e.c)}${merge.e.r + 1}`;
    sheet.mergedCells.push(start === end ? start : `${start}:${end}`);
  }
  const columns = Array.isArray(worksheet['!cols']) ? worksheet['!cols'] : [];
  columns.forEach((column, index) => {
    if (typeof column?.wch === 'number') sheet.columnWidths.push({ index, width: column.wch });
  });

  const ref = typeof worksheet['!ref'] === 'string' ? worksheet['!ref'] : '';
  if (!ref) return sheet;
  const range = utils.decode_range(ref);
  const rowCount = Math.min(range.e.r - range.s.r + 1, MAX_ROWS);
  const columnCount = Math.min(range.e.c - range.s.c + 1, MAX_COLUMNS);
  if (range.e.r - range.s.r + 1 > MAX_ROWS || range.e.c - range.s.c + 1 > MAX_COLUMNS) {
    state.truncated = true;
    state.truncationReason = `The spreadsheet was truncated at ${MAX_ROWS.toLocaleString()} rows and ${MAX_COLUMNS} columns.`;
  }
  for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
    const row: SpreadsheetCell[] = [];
    for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
      const address = utils.encode_cell({ c: range.s.c + columnOffset, r: range.s.r + rowOffset });
      const cell = worksheet[address] as
        | { t?: string; v?: unknown; f?: string; w?: string }
        | undefined;
      if (!cell || cell.t === undefined || cell.t === 'z') {
        row.push(emptyCell());
        continue;
      }
      const value: SpreadsheetCell = { text: '' };
      if (typeof cell.f === 'string' && cell.f !== '') value.formula = cell.f;
      if (cell.t === 'd' && cell.v instanceof Date) {
        value.text = formatDate(cell.v);
      } else if (cell.t === 'b') {
        const booleanValue = cell.v === true;
        value.value = booleanValue;
        value.text = booleanValue ? 'TRUE' : 'FALSE';
      } else if (cell.t === 'e') {
        value.text = typeof cell.v === 'string' ? cell.v : '#ERROR';
      } else if (typeof cell.v === 'number') {
        value.value = cell.v;
        value.text = typeof cell.w === 'string' && cell.w !== '' ? cell.w : String(cell.v);
      } else if (typeof cell.v === 'string') {
        value.text = cell.v;
      } else if (typeof cell.w === 'string') {
        value.text = cell.w;
      }
      row.push(value);
      state.cells += 1;
      if (state.cells > MAX_CELLS) {
        state.truncated = true;
        state.truncationReason = `The spreadsheet was truncated at ${MAX_CELLS.toLocaleString()} cells.`;
        break;
      }
    }
    sheet.rows.push(row);
    if (state.truncated) break;
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
  return sheet;
}

export function parseXlsWorkbook(bytes: Buffer): SpreadsheetWorkbook {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES)
    invalid('This XLS is invalid or exceeds the 40 MiB archive limit.');
  // SheetJS accepts arbitrary input and returns an empty workbook, so
  // sniff the OLE2 Compound Document signature first.
  const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(OLE2_SIGNATURE))
    invalid('This file is not a valid XLS workbook.');
  let workbook: ReturnType<typeof readWorkbook>;
  try {
    // cellStyles is required for SheetJS to populate column widths (!cols).
    workbook = readWorkbook(bytes, { type: 'buffer', cellDates: true, bookVBA: false, cellStyles: true });
  } catch {
    invalid('This XLS file could not be read. It may be corrupt or password-protected.');
  }
  if (!workbook || !workbook.SheetNames.length) invalid('The XLS workbook contains no sheets.');
  if (workbook.SheetNames.length > MAX_SHEETS)
    invalid(`The XLS workbook exceeds the ${MAX_SHEETS} sheet limit.`);
  const state = { cells: 0, truncated: false, truncationReason: undefined as string | undefined };
  const result: SpreadsheetWorkbook = {
    sourceFormat: 'xls',
    sheets: [],
    unsupportedFeatures: [],
    truncated: false,
  };
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) continue;
    result.sheets.push(readSheet(worksheet, name, state));
    if (state.truncated) break;
  }
  result.truncated = state.truncated;
  if (state.truncationReason) result.truncationReason = state.truncationReason;
  return result;
}
