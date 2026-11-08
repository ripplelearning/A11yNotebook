// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseXlsxWorkbook } from '../../electron/vault/xlsx-parser';
import { zip } from './test-zip';
import {
  columnIndex,
  columnLabel,
  parseCellReference,
} from '../../src/shared/spreadsheet';

const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function validEntries(): Record<string, string> {
  return {
    'xl/workbook.xml': `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relsNs}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<sst xmlns="${mainNs}" count="2" uniqueCount="2"><si><t>Rent</t></si><si><t>Groceries</t></si></sst>`,
    'xl/styles.xml': `<styleSheet xmlns="${mainNs}"><numFmts><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${mainNs}"><cols><col min="1" max="1" width="18"/></cols><mergeCells><mergeCell ref="A1:B1"/></mergeCells><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200</v></c><c r="C1" t="b"><v>1</v></c><c r="D1"><f>B1*2</f><v>2400</v></c><c r="E1" s="1"><v>46023</v></c><c r="F1" s="2"><v>46023</v></c><c r="G1" t="s"><v>99</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Note</t></is></c><c r="C2" t="str"><f>TEXT(B1,"0")</f><v>1200</v></c></row><row r="4"><c r="A4"><v>7</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${mainNs}"><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>`,
  };
}

describe('xlsx parser', () => {
  it('reads shared strings, numbers, booleans, inline strings, and formulas', () => {
    const workbook = parseXlsxWorkbook(zip(validEntries()));
    expect(workbook.sourceFormat).toBe('xlsx');
    expect(workbook.sheets).toHaveLength(2);
    const budget = workbook.sheets[0];
    expect(budget.name).toBe('Budget');
    expect(budget.rows[0][0].text).toBe('Rent');
    expect(budget.rows[0][1]).toMatchObject({ text: '1200', value: 1200 });
    expect(budget.rows[0][2]).toMatchObject({ text: 'TRUE', value: true });
    expect(budget.rows[0][3]).toMatchObject({ text: '2400', value: 2400, formula: 'B1*2' });
    // G1 references a shared string that does not exist, so it reads as
    // empty and the trailing empty column is trimmed.
    expect(budget.rows[0]).toHaveLength(6);
    expect(budget.rows[1][0].text).toBe('Note');
    expect(budget.rows[1][1].text).toBe('');
    expect(budget.rows[1][2]).toMatchObject({ text: '1200', formula: 'TEXT(B1,"0")' });
    expect(budget.rows[2]).toEqual([]);
    expect(budget.rows[3][0]).toMatchObject({ text: '7', value: 7 });
    expect(budget.rows).toHaveLength(4);
    expect(budget.rows[0]).toHaveLength(6);
    expect(workbook.sheets[1].rows).toEqual([[{ text: 'Groceries' }]]);
  });

  it('renders date-formatted serials as ISO dates', () => {
    const workbook = parseXlsxWorkbook(zip(validEntries()));
    expect(workbook.sheets[0].rows[0][4].text).toBe('2026-01-01');
    expect(workbook.sheets[0].rows[0][5].text).toBe('2026-01-01');
    expect(workbook.sheets[0].rows[0][4].value).toBe(46023);
  });

  it('captures merged ranges and column widths', () => {
    const workbook = parseXlsxWorkbook(zip(validEntries()));
    expect(workbook.sheets[0].mergedCells).toEqual(['A1:B1']);
    expect(workbook.sheets[0].columnWidths).toEqual([{ index: 0, width: 18 }]);
  });

  it('rejects a non-archive and a workbook without sheets', () => {
    expect(() => parseXlsxWorkbook(Buffer.from('not a zip'))).toThrow('malformed or truncated');
    const entries = validEntries();
    delete entries['xl/workbook.xml'];
    expect(() => parseXlsxWorkbook(zip(entries))).toThrow('xl/workbook.xml is missing');
    const noSheets = validEntries();
    noSheets['xl/workbook.xml'] =
      `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets></sheets></workbook>`;
    expect(() => parseXlsxWorkbook(zip(noSheets))).toThrow('contains no sheets');
  });

  it('rejects a workbook whose worksheet part is missing', () => {
    const entries = validEntries();
    delete entries['xl/worksheets/sheet2.xml'];
    expect(() => parseXlsxWorkbook(zip(entries))).toThrow('sheet2.xml is missing');
  });

  it('skips a chart sheet between worksheets instead of reporting a duplicate', () => {
    const entries = validEntries();
    entries['xl/workbook.xml'] =
      `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Chart1" sheetId="2" r:id="rId3"/><sheet name="Notes" sheetId="3" r:id="rId2"/></sheets></workbook>`;
    entries['xl/_rels/workbook.xml.rels'] =
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relsNs}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${relsNs}/chartsheet" Target="charts/chart1.xml"/></Relationships>`;
    const workbook = parseXlsxWorkbook(zip(entries));
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Budget', 'Notes']);
    expect(workbook.sheets[1].rows).toEqual([[{ text: 'Groceries' }]]);
  });

  it('still rejects two worksheets that share one part', () => {
    const entries = validEntries();
    entries['xl/workbook.xml'] =
      `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Copy" sheetId="2" r:id="rId1"/></sheets></workbook>`;
    expect(() => parseXlsxWorkbook(zip(entries))).toThrow('lists the same worksheet twice');
  });
});

describe('spreadsheet cell references', () => {
  it('converts between column indexes and letters', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(701)).toBe('ZZ');
    expect(columnIndex('A')).toBe(0);
    expect(columnIndex('Z')).toBe(25);
    expect(columnIndex('AA')).toBe(26);
    expect(parseCellReference('B2')).toEqual({ column: 1, row: 1 });
    expect(parseCellReference('AA10')).toEqual({ column: 26, row: 9 });
    expect(parseCellReference('nope')).toBeUndefined();
  });
});
