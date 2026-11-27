// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseXlsxWorkbook } from '../../electron/vault/xlsx-parser';
import { writeXlsxWorkbookFresh } from '../../electron/vault/xlsx-writer';
import { blankSpreadsheetWorkbook } from '../../src/shared/spreadsheet';

describe('blank spreadsheet creation', () => {
  it('builds one blank sheet named Sheet1', () => {
    const workbook = blankSpreadsheetWorkbook();
    expect(workbook.sourceFormat).toBe('xlsx');
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0].name).toBe('Sheet1');
    expect(workbook.sheets[0].rows).toEqual([]);
    expect(workbook.sheets[0].mergedCells).toEqual([]);
    expect(workbook.sheets[0].columnWidths).toEqual([]);
  });

  it('writes a minimal .xlsx package that parses back to the blank sheet', () => {
    const bytes = writeXlsxWorkbookFresh(blankSpreadsheetWorkbook());
    const parsed = parseXlsxWorkbook(bytes);
    expect(parsed.sourceFormat).toBe('xlsx');
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0].name).toBe('Sheet1');
    expect(parsed.sheets[0].rows).toEqual([]);
  });

  it('refuses a fresh package from a workbook that is not a spreadsheet', () => {
    const workbook = blankSpreadsheetWorkbook();
    expect(() => writeXlsxWorkbookFresh({ ...workbook, sourceFormat: 'ods' })).toThrow();
    expect(() => writeXlsxWorkbookFresh({ ...workbook, sourceFormat: 'csv' })).toThrow();
  });
});
