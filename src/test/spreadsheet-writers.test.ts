// @vitest-environment node
import { read as readSheetJs, utils as sheetJsUtils, write as writeSheetJs } from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseXlsxWorkbook } from '../../electron/vault/xlsx-parser';
import { writeXlsxWorkbook, writeXlsxWorkbookFresh } from '../../electron/vault/xlsx-writer';
import { parseOdsWorkbook } from '../../electron/vault/ods-parser';
import { writeOdsWorkbook } from '../../electron/vault/ods-writer';
import { parseCsvWorkbook } from '../../electron/vault/csv-workbook';
import { writeCsvWorkbook } from '../../electron/vault/csv-writer';
import { parseXlsWorkbook } from '../../electron/vault/xls-reader';
import { applyCellEdit } from '../../src/shared/spreadsheet';
import { readZipEntries } from '../../electron/vault/zip-archive';
import { zip } from './test-zip';

const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function xlsxFixture(): Buffer {
  return zip({
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>',
    'xl/workbook.xml': `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<sst xmlns="${mainNs}" count="1" uniqueCount="1"><si><t>Rent</t></si></sst>`,
    'xl/styles.xml': `<styleSheet xmlns="${mainNs}"><numFmts><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml':
      `<worksheet xmlns="${mainNs}"><cols><col min="1" max="1" width="18"/></cols><mergeCells><mergeCell ref="A1:B1"/></mergeCells><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200</v></c><c r="C1" t="b"><v>1</v></c><c r="D1"><f>B1*2</f><v>2400</v></c><c r="E1" s="1"><v>46023</v></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>Note</t></is></c></row>` +
      `</sheetData></worksheet>`,
  });
}

const officeNs = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const tableNs = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const textNs = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const styleNs = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';

function odsFixture(): Buffer {
  return zip({
    'content.xml':
      `<office:document-content xmlns:office="${officeNs}" xmlns:table="${tableNs}" xmlns:text="${textNs}" xmlns:style="${styleNs}" office:version="1.2">` +
      '<office:automatic-styles><style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="3.5cm"/></style:style></office:automatic-styles>' +
      '<office:body><office:spreadsheet>' +
      '<table:table table:name="Budget">' +
      '<table:table-column table:style-name="co1"/>' +
      '<table:table-row>' +
      '<table:table-cell office:value-type="string"><text:p>Rent</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="float" office:value="1200"><text:p>1200</text:p></table:table-cell>' +
      '<table:table-cell table:formula="of:=B1*2" office:value-type="float" office:value="2400"><text:p>2400</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="date" office:date-value="2026-01-01"><text:p>2026-01-01</text:p></table:table-cell>' +
      '</table:table-row>' +
      '</table:table>' +
      '</office:spreadsheet></office:body></office:document-content>',
  });
}

describe('xlsx writer round-trip', () => {
  it('saves edits, formulas, merges, widths, and dates, and keeps other parts', () => {
    const original = xlsxFixture();
    const workbook = parseXlsxWorkbook(original);
    const sheet = workbook.sheets[0];
    sheet.rows[0][1] = applyCellEdit(sheet.rows[0][1], '1300');
    sheet.rows[0][0] = applyCellEdit(sheet.rows[0][0], 'Rent (updated)');
    sheet.rows.push([{ text: 'Added row' }, { text: '5' }]);
    const written = writeXlsxWorkbook(original, workbook);
    const entries = readZipEntries(written, 'XLSX');
    expect(entries.has('docProps/core.xml')).toBe(true);
    expect(entries.has('xl/sharedStrings.xml')).toBe(true);
    const reread = parseXlsxWorkbook(written);
    const rereadSheet = reread.sheets[0];
    expect(rereadSheet.rows[0][0].text).toBe('Rent (updated)');
    expect(rereadSheet.rows[0][1]).toMatchObject({ text: '1300', value: 1300 });
    expect(rereadSheet.rows[0][2]).toMatchObject({ text: 'TRUE', value: true });
    expect(rereadSheet.rows[0][3]).toMatchObject({ text: '2400', formula: 'B1*2' });
    expect(rereadSheet.rows[0][4].text).toBe('2026-01-01');
    expect(rereadSheet.rows[2][0].text).toBe('Added row');
    expect(rereadSheet.mergedCells).toEqual(['A1:B1']);
    expect(rereadSheet.columnWidths).toEqual([{ index: 0, width: 18 }]);
    // An independent reader (SheetJS) opens the written package.
    const independent = readSheetJs(written, { type: 'buffer' });
    const values = sheetJsUtils.sheet_to_json(independent.Sheets['Budget'], { header: 1 }) as unknown[][];
    expect(values[0][0]).toBe('Rent (updated)');
    expect(values[0][1]).toBe(1300);
  });
});

describe('xls save-as-xlsx', () => {
  it('builds a fresh package the in-house and independent readers both open', () => {
    const wb = sheetJsUtils.book_new();
    const ws = sheetJsUtils.aoa_to_sheet([
      ['Rent', 1200],
      ['Note', 7],
    ]);
    sheetJsUtils.book_append_sheet(wb, ws, 'Budget');
    const xlsBytes = writeSheetJs(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
    const workbook = parseXlsWorkbook(xlsBytes);
    const written = writeXlsxWorkbookFresh(workbook);
    const reread = parseXlsxWorkbook(written);
    expect(reread.sheets[0].rows[0][0].text).toBe('Rent');
    expect(reread.sheets[0].rows[0][1]).toMatchObject({ text: '1200', value: 1200 });
    const independent = readSheetJs(written, { type: 'buffer' });
    expect(independent.SheetNames).toEqual(['Budget']);
  });
});

describe('ods writer round-trip', () => {
  it('saves edits and formulas and keeps the original styles', () => {
    const original = odsFixture();
    const workbook = parseOdsWorkbook(original);
    const sheet = workbook.sheets[0];
    sheet.rows[0][1] = applyCellEdit(sheet.rows[0][1], '1300');
    sheet.rows.push([{ text: 'Added row' }]);
    const written = writeOdsWorkbook(original, workbook);
    const writtenContent = readZipEntries(written, 'ODS').get('content.xml')!.bytes.toString('utf8');
    expect(writtenContent).toContain('style:name="co1"');
    const reread = parseOdsWorkbook(written);
    expect(reread.sheets[0].rows[0][1]).toMatchObject({ text: '1300', value: 1300 });
    expect(reread.sheets[0].rows[0][2]).toMatchObject({ text: '2400', formula: 'B1*2' });
    expect(reread.sheets[0].rows[0][3].text).toBe('2026-01-01');
    expect(reread.sheets[0].rows[1][0].text).toBe('Added row');
    expect(reread.sheets[0].columnWidths).toEqual([{ index: 0, width: 3.5 }]);
  });
});

describe('csv writer round-trip', () => {
  it('quotes fields that need it and survives a re-read', () => {
    const workbook = parseCsvWorkbook('Name,Amount\nRent,1200\n', 'Budget');
    workbook.sheets[0].rows[1][0] = applyCellEdit(workbook.sheets[0].rows[1][0], 'Rent, with comma');
    workbook.sheets[0].rows.push([{ text: 'Say "hi"' }, { text: '3' }]);
    const text = writeCsvWorkbook(workbook);
    const reread = parseCsvWorkbook(text, 'Budget');
    expect(reread.sheets[0].rows[1][0].text).toBe('Rent, with comma');
    expect(reread.sheets[0].rows[2][0].text).toBe('Say "hi"');
  });
});

describe('applyCellEdit', () => {
  it('derives numbers, booleans, and dates, and clears formulas', () => {
    expect(applyCellEdit({ text: '1200', value: 1200 }, '1300')).toMatchObject({
      text: '1300',
      value: 1300,
    });
    expect(applyCellEdit({ text: 'x' }, 'true')).toMatchObject({ text: 'TRUE', value: true });
    expect(applyCellEdit({ text: 'x', formula: 'B1*2', value: 2400 }, '9')).toMatchObject({
      text: '9',
      value: 9,
    });
    expect(applyCellEdit({ text: 'x', formula: 'B1*2', value: 2400 }, '9').formula).toBeUndefined();
    const dateCell = applyCellEdit({ text: '2026-01-01', value: 46023, styleIndex: 1 }, '2026-02-01');
    expect(dateCell).toMatchObject({ text: '2026-02-01', styleIndex: 1 });
    expect(typeof dateCell.value).toBe('number');
    expect(applyCellEdit({ text: 'x' }, '')).toEqual({ text: '' });
  });
});
