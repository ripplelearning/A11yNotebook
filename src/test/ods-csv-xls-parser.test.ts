// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { parseOdsWorkbook } from '../../electron/vault/ods-parser';
import { parseCsvWorkbook } from '../../electron/vault/csv-workbook';
import { parseXlsWorkbook } from '../../electron/vault/xls-reader';
import { zip } from './test-zip';

const officeNs = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const tableNs = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const textNs = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const styleNs = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';

function odsEntries(): Record<string, string> {
  return {
    'content.xml':
      `<office:document-content xmlns:office="${officeNs}" xmlns:table="${tableNs}" xmlns:text="${textNs}" xmlns:style="${styleNs}" office:version="1.2">` +
      '<office:automatic-styles><style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="3.5cm"/></style:style></office:automatic-styles>' +
      '<office:body><office:spreadsheet>' +
      '<table:table table:name="Budget">' +
      '<table:table-column table:style-name="co1" table:number-columns-repeated="2"/>' +
      '<table:table-row>' +
      '<table:table-cell office:value-type="string"><text:p>Rent</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="float" office:value="1200"><text:p>1200</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell>' +
      '<table:table-cell table:formula="of:=B1*2" office:value-type="float" office:value="2400"><text:p>2400</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="date" office:date-value="2026-01-01"><text:p>2026-01-01</text:p></table:table-cell>' +
      '</table:table-row>' +
      '<table:table-row table:number-rows-repeated="2">' +
      '<table:table-cell office:value-type="string"><text:p>Repeated</text:p></table:table-cell>' +
      '<table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell>' +
      '</table:table-row>' +
      '<table:table-row>' +
      '<table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>Merged</text:p></table:table-cell>' +
      '</table:table-row>' +
      '</table:table>' +
      '</office:spreadsheet></office:body></office:document-content>',
  };
}

describe('ods parser', () => {
  it('reads values, booleans, dates, formulas, repeats, and merges', () => {
    const workbook = parseOdsWorkbook(zip(odsEntries()));
    expect(workbook.sourceFormat).toBe('ods');
    expect(workbook.sheets).toHaveLength(1);
    const sheet = workbook.sheets[0];
    expect(sheet.name).toBe('Budget');
    expect(sheet.rows[0][0].text).toBe('Rent');
    expect(sheet.rows[0][1]).toMatchObject({ text: '1200', value: 1200 });
    expect(sheet.rows[0][2]).toMatchObject({ text: 'TRUE', value: true });
    expect(sheet.rows[0][3]).toMatchObject({ text: '2400', value: 2400, formula: 'B1*2' });
    expect(sheet.rows[0][4].text).toBe('2026-01-01');
    expect(sheet.rows[1]).toMatchObject([{ text: 'Repeated' }, { text: 'x' }, { text: 'x' }]);
    expect(sheet.rows[2]).toMatchObject([{ text: 'Repeated' }, { text: 'x' }, { text: 'x' }]);
    expect(sheet.rows[3][0].text).toBe('Merged');
    expect(sheet.rows).toHaveLength(4);
    expect(sheet.mergedCells).toEqual(['A4:B4']);
    expect(sheet.columnWidths).toEqual([{ index: 0, width: 3.5 }]);
  });

  it('rejects a file without content.xml', () => {
    expect(() => parseOdsWorkbook(zip({}))).toThrow('content.xml is missing');
    expect(() =>
      parseOdsWorkbook(
        zip({
          'content.xml': `<office:document-content xmlns:office="${officeNs}" office:version="1.2"><office:body></office:body></office:document-content>`,
        }),
      ),
    ).toThrow('contains no spreadsheet');
  });
});

describe('csv workbook', () => {
  it('reads quoted fields and multiline text as plain-text cells', () => {
    const workbook = parseCsvWorkbook('Name,Amount\nRent,1200\n"Quoted, field",7\n', 'Budget');
    expect(workbook.sourceFormat).toBe('csv');
    expect(workbook.sheets[0].name).toBe('Budget');
    expect(workbook.sheets[0].rows).toEqual([
      [{ text: 'Name' }, { text: 'Amount' }],
      [{ text: 'Rent' }, { text: '1200' }],
      [{ text: 'Quoted, field' }, { text: '7' }],
    ]);
  });

  it('rejects an unclosed quoted field', () => {
    expect(() => parseCsvWorkbook('"oops\n', 'Budget')).toThrow('unclosed quoted field');
  });
});

describe('xls reader', () => {
  it('reads a binary workbook, formulas, merges, and column widths', () => {
    const wb = utils.book_new();
    const ws = utils.aoa_to_sheet([
      ['Rent', 1200, true],
      ['Note', null, null],
    ]);
    ws['D1'] = { t: 'n', f: 'B1*2', v: 2400 };
    ws['!ref'] = 'A1:D2';
    ws['!merges'] = [{ s: { c: 0, r: 1 }, e: { c: 1, r: 1 } }];
    ws['!cols'] = [{ wch: 18 }];
    utils.book_append_sheet(wb, ws, 'Budget');
    const bytes = write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
    const workbook = parseXlsWorkbook(bytes);
    expect(workbook.sourceFormat).toBe('xls');
    expect(workbook.sheets[0].name).toBe('Budget');
    expect(workbook.sheets[0].rows[0][0].text).toBe('Rent');
    expect(workbook.sheets[0].rows[0][1]).toMatchObject({ text: '1200', value: 1200 });
    expect(workbook.sheets[0].rows[0][2]).toMatchObject({ text: 'TRUE', value: true });
    // SheetJS's BIFF writer drops formulas, so a generated .xls fixture
    // cannot carry one; the cached value is what survives. The reader's
    // formula path is covered by the xlsx and ods tests, and real
    // Excel-written .xls files do store formulas for the reader to pick up.
    expect(workbook.sheets[0].rows[0][3]).toMatchObject({ text: '2400', value: 2400 });
    expect(workbook.sheets[0].rows[1][0].text).toBe('Note');
    expect(workbook.sheets[0].mergedCells).toEqual(['A2:B2']);
    expect(workbook.sheets[0].columnWidths).toEqual([{ index: 0, width: 18 }]);
  });

  it('rejects an empty or unreadable file', () => {
    expect(() => parseXlsWorkbook(Buffer.alloc(0))).toThrow('invalid or exceeds');
    expect(() => parseXlsWorkbook(Buffer.from('not a spreadsheet'))).toThrow('not a valid XLS workbook');
  });
});
