import { readZipEntries } from './zip-archive';
import { escapeXml, writeZipEntries } from './zip-write';
import { xlsxSheetParts } from './xlsx-parser';
import {
  columnLabel,
  type SpreadsheetCell,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from '../../src/shared/spreadsheet';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function invalid(message: string): never {
  throw new Error(message);
}

function cellXml(cell: SpreadsheetCell, column: number, row: number): string {
  const ref = `${columnLabel(column)}${row + 1}`;
  const style = cell.styleIndex !== undefined ? ` s="${cell.styleIndex}"` : '';
  if (cell.formula) {
    const cached =
      typeof cell.value === 'number'
        ? String(cell.value)
        : typeof cell.value === 'boolean'
          ? '1'
          : escapeXml(cell.text);
    return `<c r="${ref}"${style}><f>${escapeXml(cell.formula)}</f><v>${cached}</v></c>`;
  }
  if (typeof cell.value === 'boolean') {
    return `<c r="${ref}"${style} t="b"><v>${cell.value ? '1' : '0'}</v></c>`;
  }
  if (typeof cell.value === 'number') {
    return `<c r="${ref}"${style}><v>${String(cell.value)}</v></c>`;
  }
  if (cell.text === '') return '';
  const preserve = /^\s|\s$|\n/.test(cell.text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${style} t="inlineStr"><is><t${preserve}>${escapeXml(cell.text)}</t></is></c>`;
}

function sheetXml(sheet: SpreadsheetSheet): string {
  let lastRow = -1;
  let lastColumn = -1;
  sheet.rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (cell.text !== '' || cell.value !== undefined || cell.formula) {
        lastRow = Math.max(lastRow, rowIndex);
        lastColumn = Math.max(lastColumn, columnIndex);
      }
    });
  });
  const dimension =
    lastRow < 0 ? 'A1' : `A1:${columnLabel(lastColumn)}${lastRow + 1}`;
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
  parts.push(`<worksheet xmlns="${NS}" xmlns:r="${RELS_NS}">`);
  parts.push(`<dimension ref="${dimension}"/>`);
  parts.push(`<sheetViews><sheetView workbookViewId="0"/></sheetViews>`);
  parts.push(`<sheetFormatPr defaultRowHeight="15"/>`);
  if (sheet.columnWidths.length) {
    const cols = sheet.columnWidths
      .map(({ index, width }) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
      .join('');
    parts.push(`<cols>${cols}</cols>`);
  }
  parts.push('<sheetData>');
  sheet.rows.forEach((row, rowIndex) => {
    const cells = row
      .map((cell, columnIndex) => cellXml(cell, columnIndex, rowIndex))
      .filter((xml) => xml !== '')
      .join('');
    if (cells) parts.push(`<row r="${rowIndex + 1}">${cells}</row>`);
  });
  parts.push('</sheetData>');
  if (sheet.mergedCells.length) {
    const merges = sheet.mergedCells.map((ref) => `<mergeCell ref="${escapeXml(ref)}"/>`).join('');
    parts.push(`<mergeCells count="${sheet.mergedCells.length}">${merges}</mergeCells>`);
  }
  parts.push('</worksheet>');
  return parts.join('');
}

/**
 * Save a workbook back into its .xlsx package: every worksheet part is
 * regenerated from the model and every other part passes through
 * untouched, so styles, images, and charts survive. Edited string cells
 * are written inline, so the shared-strings part is reset to empty.
 * Also used for .xls save-as-.xlsx: the caller supplies the .xls bytes
 * read as a workbook and a fresh minimal package is built instead.
 */
export function writeXlsxWorkbook(originalBytes: Buffer, workbook: SpreadsheetWorkbook): Buffer {
  if (workbook.sourceFormat !== 'xlsx') {
    invalid('XLSX saving requires an xlsx workbook.');
  }
  const entries = readZipEntries(originalBytes, 'XLSX');
  const parts = xlsxSheetParts(entries);
  if (parts.length !== workbook.sheets.length) {
    invalid('The spreadsheet changed shape since it was opened. Save is not possible.');
  }
  parts.forEach((part, index) => {
    entries.set(part.partPath, {
      path: part.partPath,
      bytes: Buffer.from(sheetXml(workbook.sheets[index]), 'utf8'),
    });
  });
  const sharedStrings = entries.get('xl/sharedStrings.xml');
  if (sharedStrings) {
    entries.set('xl/sharedStrings.xml', {
      path: 'xl/sharedStrings.xml',
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS}" count="0" uniqueCount="0"/>`,
        'utf8',
      ),
    });
  }
  return writeZipEntries(entries);
}

/** Minimal .xlsx package for an .xls workbook saved as .xlsx. */
export function writeXlsxWorkbookFresh(workbook: SpreadsheetWorkbook): Buffer {
  if (workbook.sourceFormat !== 'xls') invalid('Fresh XLSX packages are only built from xls workbooks.');
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    workbook.sheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    workbook.sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${workbook.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${NS}" xmlns:r="${RELS_NS}"><sheets>` +
    workbook.sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join('') +
    `</sheets></workbook>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const entries = new Map<string, { path: string; bytes: Buffer }>();
  const add = (path: string, text: string) => entries.set(path, { path, bytes: Buffer.from(text, 'utf8') });
  add('[Content_Types].xml', contentTypes);
  add('_rels/.rels', rels);
  add('xl/workbook.xml', workbookXml);
  add('xl/_rels/workbook.xml.rels', workbookRels);
  add('xl/styles.xml', styles);
  workbook.sheets.forEach((sheet, index) => {
    add(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet));
  });
  return writeZipEntries(entries);
}
