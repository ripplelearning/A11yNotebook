import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentView from '../renderer/features/previews/AttachmentView';
import type { SpreadsheetWorkbook } from '../shared/spreadsheet';

const workbook: SpreadsheetWorkbook = {
  sourceFormat: 'xlsx',
  sheets: [
    {
      name: 'Budget',
      rows: [
        [{ text: 'Rent' }, { text: '1200', value: 1200 }, { text: 'Note' }],
        [{ text: 'Food' }, { text: '300', value: 300 }, { text: '' }],
        [{ text: 'Total' }, { text: '1500', value: 1500, formula: 'SUM(B1:B2)' }, { text: '' }],
      ],
      mergedCells: [],
      columnWidths: [],
    },
    {
      name: 'Merged',
      rows: [
        [{ text: 'Title' }, { text: '' }],
        [{ text: '' }, { text: 'x' }],
      ],
      mergedCells: ['A1:B1'],
      columnWidths: [],
    },
    { name: 'Third', rows: [[{ text: 'Only' }]], mergedCells: [], columnWidths: [] },
  ],
  unsupportedFeatures: [],
  truncated: false,
};

function stubVault(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('a11yNotebook', {
    vault: {
      readSpreadsheet: vi.fn(async () => structuredClone(workbook)),
      saveSpreadsheet: vi.fn(async () => undefined),
      saveSpreadsheetAsXlsx: vi.fn(async () => 'Budget.xlsx'),
      ...overrides,
    },
  });
}

function renderSheet() {
  const announce = vi.fn();
  const sheetRef = { current: null as { nextSheet: () => boolean; previousSheet: () => boolean } | null };
  render(
    <AttachmentView
      preview={{ path: 'Sheets/Budget.xlsx', kind: '.xlsx', text: '' }}
      alt=""
      onSaveAlt={vi.fn()}
      onExternal={vi.fn()}
      announce={announce}
      spreadsheetSheetRef={sheetRef}
      onSpreadsheetFileCreated={vi.fn()}
    />,
  );
  return { announce, sheetRef };
}

function activeCell() {
  return document.activeElement as HTMLElement;
}

describe('spreadsheet grid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders a grid with roving tabindex and labelled cells', async () => {
    stubVault();
    renderSheet();
    expect(await screen.findByRole('grid', { name: 'Budget — 3 rows' })).toBeInTheDocument();
    const a1 = screen.getByLabelText('Row 1, column A, Rent');
    expect(a1).toHaveAttribute('tabindex', '0');
    expect(a1.getAttribute('role')).toBe('gridcell');
    expect(screen.getByLabelText('Row 1, column B, 1200')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByLabelText('Row 3, column B, formula, 1500')).toBeInTheDocument();
  });

  it('moves the active cell with arrow keys, Home, End, and Ctrl+Home/Ctrl+End', async () => {
    stubVault();
    renderSheet();
    const a1 = await screen.findByLabelText('Row 1, column A, Rent');
    a1.focus();
    fireEvent.keyDown(a1, { key: 'ArrowRight' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column B, 1200');
    fireEvent.keyDown(activeCell(), { key: 'ArrowDown' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column B, 300');
    fireEvent.keyDown(activeCell(), { key: 'End' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column C, empty');
    fireEvent.keyDown(activeCell(), { key: 'Home' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column A, Food');
    fireEvent.keyDown(activeCell(), { key: 'End', ctrlKey: true });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 3, column C, empty');
    fireEvent.keyDown(activeCell(), { key: 'Home', ctrlKey: true });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column A, Rent');
    // Arrow keys stop at the edges instead of leaving the sheet.
    fireEvent.keyDown(activeCell(), { key: 'ArrowUp' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column A, Rent');
  });

  it('moves by page and wraps Tab across rows', async () => {
    stubVault();
    renderSheet();
    const a1 = await screen.findByLabelText('Row 1, column A, Rent');
    a1.focus();
    fireEvent.keyDown(a1, { key: 'PageDown' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 3, column A, Total');
    fireEvent.keyDown(activeCell(), { key: 'PageUp' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column A, Rent');
    fireEvent.keyDown(activeCell(), { key: 'Tab' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column B, 1200');
    fireEvent.keyDown(activeCell(), { key: 'Tab' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column C, Note');
    fireEvent.keyDown(activeCell(), { key: 'Tab' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column A, Food');
    fireEvent.keyDown(activeCell(), { key: 'Tab', shiftKey: true });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column C, Note');
  });

  it('extends a range with Shift+arrows and announces its size', async () => {
    stubVault();
    const { announce } = renderSheet();
    const a1 = await screen.findByLabelText('Row 1, column A, Rent');
    a1.focus();
    fireEvent.keyDown(a1, { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByLabelText('Row 1, column A, Rent')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Row 1, column B, 1200')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Row 1, column C, Note')).toHaveAttribute('aria-selected', 'false');
    expect(announce).toHaveBeenCalledWith('A1 to B1, 1 row by 2 columns');
    fireEvent.keyDown(activeCell(), { key: 'ArrowDown', shiftKey: true });
    expect(announce).toHaveBeenCalledWith('A1 to B2, 2 rows by 2 columns');
    // A plain arrow collapses the range back to one cell.
    fireEvent.keyDown(activeCell(), { key: 'ArrowDown' });
    expect(screen.getByLabelText('Row 3, column B, formula, 1500')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Row 1, column A, Rent')).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking sets the active cell and Shift+click extends the range', async () => {
    stubVault();
    renderSheet();
    const b2 = await screen.findByLabelText('Row 2, column B, 300');
    fireEvent.click(b2);
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column B, 300');
    const c3 = screen.getByLabelText('Row 3, column C, empty');
    fireEvent.click(c3, { shiftKey: true });
    expect(screen.getByLabelText('Row 2, column B, 300')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Row 3, column C, empty')).toHaveAttribute('aria-selected', 'true');
  });

  it('edits with F2, commits with Enter and moves down, cancels with Escape', async () => {
    stubVault();
    renderSheet();
    const b1 = await screen.findByLabelText('Row 1, column B, 1200');
    fireEvent.click(b1);
    fireEvent.keyDown(b1, { key: 'F2' });
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('1200');
    fireEvent.change(input, { target: { value: '1300' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('Row 1, column B, 1300')).toBeInTheDocument();
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column B, 300');
    // Escape restores the prior value.
    fireEvent.keyDown(activeCell(), { key: 'F2' });
    const second = screen.getByRole('textbox');
    fireEvent.change(second, { target: { value: '9999' } });
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.getByLabelText('Row 2, column B, 300')).toBeInTheDocument();
    expect(screen.queryByLabelText('Row 2, column B, 9999')).not.toBeInTheDocument();
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column B, 300');
  });

  it('typing starts editing with that character, and blur commits', async () => {
    stubVault();
    renderSheet();
    const a1 = await screen.findByLabelText('Row 1, column A, Rent');
    a1.focus();
    fireEvent.keyDown(a1, { key: 'x' });
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('x');
    fireEvent.change(input, { target: { value: 'xray' } });
    fireEvent.blur(input);
    expect(screen.getByLabelText('Row 1, column A, xray')).toBeInTheDocument();
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column A, xray');
  });

  it('double-click edits, and Enter moves down while Shift+Enter moves up', async () => {
    stubVault();
    renderSheet();
    const a2 = await screen.findByLabelText('Row 2, column A, Food');
    fireEvent.doubleClick(a2);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Snacks' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByLabelText('Row 2, column A, Snacks')).toBeInTheDocument();
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column A, Rent');
  });

  it('announces merged cells and skips covered cells', async () => {
    stubVault();
    renderSheet();
    await screen.findByLabelText('Row 1, column A, Rent');
    fireEvent.change(screen.getByLabelText('Sheet'), { target: { value: '1' } });
    const title = await screen.findByLabelText('Row 1, column A, merged across 2 columns, Title');
    expect(title).toHaveAttribute('colspan', '2');
    expect(screen.queryByLabelText('Row 1, column B, empty')).not.toBeInTheDocument();
    title.focus();
    fireEvent.keyDown(title, { key: 'ArrowDown' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 2, column A, empty');
    // Right from the merged anchor has nowhere to go on a two-column sheet.
    fireEvent.keyDown(activeCell(), { key: 'ArrowUp' });
    fireEvent.keyDown(activeCell(), { key: 'ArrowRight' });
    expect(activeCell()).toHaveAttribute('aria-label', 'Row 1, column A, merged across 2 columns, Title');
  });

  it('switches sheets through the registered sheet API', async () => {
    stubVault();
    const { announce, sheetRef } = renderSheet();
    await screen.findByLabelText('Row 1, column A, Rent');
    expect(sheetRef.current).not.toBeNull();
    expect(sheetRef.current?.nextSheet()).toBe(true);
    expect(await screen.findByLabelText('Row 1, column A, merged across 2 columns, Title')).toBeInTheDocument();
    expect(announce).toHaveBeenCalledWith('Sheet Merged.');
    expect(sheetRef.current?.nextSheet()).toBe(true);
    expect(await screen.findByLabelText('Row 1, column A, Only')).toBeInTheDocument();
    expect(sheetRef.current?.nextSheet()).toBe(true);
    expect(await screen.findByLabelText('Row 1, column A, Rent')).toBeInTheDocument();
    expect(sheetRef.current?.previousSheet()).toBe(true);
    expect(await screen.findByLabelText('Row 1, column A, Only')).toBeInTheDocument();
  });
});

describe('spreadsheet sheet API with one sheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says so instead of switching', async () => {
    const single: SpreadsheetWorkbook = {
      sourceFormat: 'xlsx',
      sheets: [{ name: 'Only', rows: [[{ text: 'x' }]], mergedCells: [], columnWidths: [] }],
      unsupportedFeatures: [],
      truncated: false,
    };
    vi.stubGlobal('a11yNotebook', {
      vault: {
        readSpreadsheet: vi.fn(async () => structuredClone(single)),
        saveSpreadsheet: vi.fn(async () => undefined),
        saveSpreadsheetAsXlsx: vi.fn(async () => 'Only.xlsx'),
      },
    });
    const announce = vi.fn();
    const sheetRef = { current: null as { nextSheet: () => boolean; previousSheet: () => boolean } | null };
    render(
      <AttachmentView
        preview={{ path: 'Sheets/Only.xlsx', kind: '.xlsx', text: '' }}
        alt=""
        onSaveAlt={vi.fn()}
        onExternal={vi.fn()}
        announce={announce}
        spreadsheetSheetRef={sheetRef}
        onSpreadsheetFileCreated={vi.fn()}
      />,
    );
    await screen.findByLabelText('Row 1, column A, x');
    expect(sheetRef.current?.nextSheet()).toBe(true);
    expect(announce).toHaveBeenCalledWith('This workbook has only one sheet.');
  });
});
