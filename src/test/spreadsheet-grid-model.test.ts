import { describe, expect, it } from 'vitest';
import {
  buildMergedCellMap,
  clampPosition,
  describeCell,
  describeSelection,
  isCellInSelection,
  moveActive,
  movePage,
  moveToEdge,
  normalizeSelection,
  resolvePosition,
  selectionCellCount,
  type GridSelection,
} from '../shared/spreadsheet-grid';

const BOUNDS = { rowCount: 5, columnCount: 4 };
const EMPTY_MERGED = buildMergedCellMap([]);

function selection(row: number, column: number): GridSelection {
  return { anchor: { row, column }, active: { row, column } };
}

describe('merged cell map', () => {
  it('records anchors and covered cells, and ignores bad ranges', () => {
    const map = buildMergedCellMap(['A1:B2', 'D4', 'bogus']);
    expect(map.anchors.get('0:0')).toEqual({ anchor: { row: 0, column: 0 }, rowSpan: 2, columnSpan: 2 });
    expect(map.covered.get('0:1')).toEqual({ row: 0, column: 0 });
    expect(map.covered.get('1:1')).toEqual({ row: 0, column: 0 });
    expect(map.covered.has('0:0')).toBe(false);
    expect(map.anchors.get('3:3')).toEqual({ anchor: { row: 3, column: 3 }, rowSpan: 1, columnSpan: 1 });
    expect(map.anchors.size).toBe(2);
  });

  it('resolves a covered cell to its anchor and leaves other cells alone', () => {
    const map = buildMergedCellMap(['B2:C3']);
    expect(resolvePosition(map, 2, 2)).toEqual({ row: 1, column: 1 });
    expect(resolvePosition(map, 1, 1)).toEqual({ row: 1, column: 1 });
    expect(resolvePosition(map, 0, 0)).toEqual({ row: 0, column: 0 });
  });
});

describe('clamping', () => {
  it('clamps to the used rectangle and to 0,0 for an empty sheet', () => {
    expect(clampPosition(9, 9, BOUNDS)).toEqual({ row: 4, column: 3 });
    expect(clampPosition(-2, -1, BOUNDS)).toEqual({ row: 0, column: 0 });
    expect(clampPosition(3, 3, { rowCount: 0, columnCount: 0 })).toEqual({ row: 0, column: 0 });
  });
});

describe('arrow movement', () => {
  it('moves one cell and collapses the selection', () => {
    expect(moveActive(selection(1, 1), 'right', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(1, 2));
    expect(moveActive(selection(1, 1), 'up', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(0, 1));
  });

  it('stops at the edges instead of leaving the sheet', () => {
    expect(moveActive(selection(0, 0), 'up', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(0, 0));
    expect(moveActive(selection(4, 3), 'right', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(4, 3));
  });

  it('keeps the anchor when extending, and collapses it on a plain move', () => {
    const extended = moveActive(selection(1, 1), 'right', BOUNDS, EMPTY_MERGED, true);
    expect(extended).toEqual({ anchor: { row: 1, column: 1 }, active: { row: 1, column: 2 } });
    const collapsed = moveActive(extended, 'down', BOUNDS, EMPTY_MERGED, false);
    expect(collapsed).toEqual(selection(2, 2));
  });

  it('skips over merged cells instead of stopping on a covered cell', () => {
    const map = buildMergedCellMap(['A1:B1', 'C2:C3']);
    // Right from the A1:B1 anchor lands on C1, past the span.
    expect(moveActive(selection(0, 0), 'right', BOUNDS, map, false)).toEqual(selection(0, 2));
    // Left from C1 lands on the A1 anchor, not on covered B1.
    expect(moveActive(selection(0, 2), 'left', BOUNDS, map, false)).toEqual(selection(0, 0));
    // Down from the C2:C3 anchor lands on C4, past the span.
    expect(moveActive(selection(1, 2), 'down', BOUNDS, map, false)).toEqual(selection(3, 2));
    // Down into the merge from above lands on its anchor.
    expect(moveActive(selection(0, 2), 'down', BOUNDS, map, false)).toEqual(selection(1, 2));
  });
});

describe('edge and page movement', () => {
  it('jumps within the row and to the first and last used cells', () => {
    expect(moveToEdge(selection(2, 2), 'home', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(2, 0));
    expect(moveToEdge(selection(2, 2), 'end', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(2, 3));
    expect(moveToEdge(selection(2, 2), 'first-cell', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(0, 0));
    expect(moveToEdge(selection(2, 2), 'last-cell', BOUNDS, EMPTY_MERGED, false)).toEqual(selection(4, 3));
  });

  it('moves by the visible page and clamps at the ends', () => {
    expect(movePage(selection(0, 1), 'down', 2, BOUNDS, EMPTY_MERGED, false)).toEqual(selection(2, 1));
    expect(movePage(selection(4, 1), 'down', 2, BOUNDS, EMPTY_MERGED, false)).toEqual(selection(4, 1));
    expect(movePage(selection(1, 1), 'up', 2, BOUNDS, EMPTY_MERGED, false)).toEqual(selection(0, 1));
  });
});

describe('selection shape', () => {
  it('normalizes a backwards range and counts its cells', () => {
    const range = normalizeSelection({ anchor: { row: 3, column: 3 }, active: { row: 1, column: 1 } });
    expect(range).toEqual({ startRow: 1, endRow: 3, startColumn: 1, endColumn: 3 });
    expect(selectionCellCount({ anchor: { row: 3, column: 3 }, active: { row: 1, column: 1 } })).toBe(9);
    expect(isCellInSelection({ anchor: { row: 1, column: 1 }, active: { row: 3, column: 3 } }, 2, 2)).toBe(true);
    expect(isCellInSelection({ anchor: { row: 1, column: 1 }, active: { row: 3, column: 3 } }, 0, 0)).toBe(false);
  });
});

describe('accessible names', () => {
  it('names a plain cell, an empty cell, and a formula cell like the old inputs did', () => {
    expect(describeCell(0, 0, { text: 'Rent' }, EMPTY_MERGED)).toBe('Row 1, column A, Rent');
    expect(describeCell(1, 1, { text: '' }, EMPTY_MERGED)).toBe('Row 2, column B, empty');
    expect(describeCell(2, 1, { text: '1500', formula: 'SUM(B1:B2)' }, EMPTY_MERGED)).toBe(
      'Row 3, column B, formula, 1500',
    );
  });

  it('says how far a merged cell spans', () => {
    const map = buildMergedCellMap(['A1:B2', 'D1:E1', 'A4:A5']);
    expect(describeCell(0, 0, { text: 'Title' }, map)).toBe(
      'Row 1, column A, merged across 2 columns and 2 rows, Title',
    );
    expect(describeCell(0, 3, { text: 'Head' }, map)).toBe('Row 1, column D, merged across 2 columns, Head');
    expect(describeCell(3, 0, { text: 'Notes' }, map)).toBe('Row 4, column A, merged across 2 rows, Notes');
  });

  it('describes a single cell and a range in plain language', () => {
    expect(describeSelection(selection(1, 1))).toBe('B2');
    expect(describeSelection({ anchor: { row: 1, column: 1 }, active: { row: 3, column: 3 } })).toBe(
      'B2 to D4, 3 rows by 3 columns',
    );
    expect(describeSelection({ anchor: { row: 0, column: 0 }, active: { row: 0, column: 2 } })).toBe(
      'A1 to C1, 1 row by 3 columns',
    );
  });
});
