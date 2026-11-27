// Shared spreadsheet grid model: navigation, selection, and the
// accessible names for cells. Pure functions with no DOM dependency, so
// the unit tests exercise the same movement the view uses.
//
// Coordinates are 0-based: row 0 is row 1 on screen, column 0 is A.
// The selection is an anchor (where a range started) plus the active
// cell (where it ends); a plain move collapses both to the new cell.
import { columnLabel, parseCellReference, type SpreadsheetCell } from './spreadsheet';

export interface GridPosition {
  row: number;
  column: number;
}

export interface GridSelection {
  anchor: GridPosition;
  active: GridPosition;
}

export interface GridBounds {
  rowCount: number;
  columnCount: number;
}

export interface MergedRange {
  anchor: GridPosition;
  rowSpan: number;
  columnSpan: number;
}

/** Merged-range lookup built from a sheet's mergedCells list. */
export interface MergedCellMap {
  /** Merged range by "row:column" key of its anchor cell. */
  anchors: Map<string, MergedRange>;
  /** Anchor position by "row:column" key of every covered (non-anchor) cell. */
  covered: Map<string, GridPosition>;
}

function key(row: number, column: number): string {
  return `${row}:${column}`;
}

export function buildMergedCellMap(mergedCells: string[]): MergedCellMap {
  const anchors = new Map<string, MergedRange>();
  const covered = new Map<string, GridPosition>();
  for (const range of mergedCells) {
    const [start, end] = range.split(':');
    const from = parseCellReference(start);
    const to = end ? parseCellReference(end) : from;
    if (!from || !to) continue;
    const anchor = { row: from.row, column: from.column };
    anchors.set(key(from.row, from.column), {
      anchor,
      rowSpan: to.row - from.row + 1,
      columnSpan: to.column - from.column + 1,
    });
    for (let row = from.row; row <= to.row; row += 1) {
      for (let column = from.column; column <= to.column; column += 1) {
        if (row !== from.row || column !== from.column) covered.set(key(row, column), anchor);
      }
    }
  }
  return { anchors, covered };
}

/** The merged range anchored at this cell, when the cell is an anchor. */
export function mergedRangeAt(map: MergedCellMap, row: number, column: number): MergedRange | undefined {
  return map.anchors.get(key(row, column));
}

/** A covered cell resolves to its merge anchor; any other cell resolves to itself. */
export function resolvePosition(map: MergedCellMap, row: number, column: number): GridPosition {
  return map.covered.get(key(row, column)) ?? { row, column };
}

export function clampPosition(row: number, column: number, bounds: GridBounds): GridPosition {
  return {
    row: Math.max(0, Math.min(row, Math.max(0, bounds.rowCount - 1))),
    column: Math.max(0, Math.min(column, Math.max(0, bounds.columnCount - 1))),
  };
}

export function normalizeSelection(selection: GridSelection): {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
} {
  return {
    startRow: Math.min(selection.anchor.row, selection.active.row),
    endRow: Math.max(selection.anchor.row, selection.active.row),
    startColumn: Math.min(selection.anchor.column, selection.active.column),
    endColumn: Math.max(selection.anchor.column, selection.active.column),
  };
}

export function isCellInSelection(selection: GridSelection, row: number, column: number): boolean {
  const range = normalizeSelection(selection);
  return row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn;
}

export function selectionCellCount(selection: GridSelection): number {
  const range = normalizeSelection(selection);
  return (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
}

/**
 * One step from the active cell. Moving right from a merged anchor
 * lands past its span; moving into a merged range lands on its anchor,
 * so the cursor never stops on a covered cell.
 */
export function moveActive(
  selection: GridSelection,
  direction: 'up' | 'down' | 'left' | 'right',
  bounds: GridBounds,
  merged: MergedCellMap,
  extend: boolean,
): GridSelection {
  const current = resolvePosition(merged, selection.active.row, selection.active.column);
  let row = current.row;
  let column = current.column;
  if (direction === 'up') row -= 1;
  if (direction === 'down') {
    const span = mergedRangeAt(merged, current.row, current.column)?.rowSpan ?? 1;
    row = current.row + span;
  }
  if (direction === 'left') column -= 1;
  if (direction === 'right') {
    const span = mergedRangeAt(merged, current.row, current.column)?.columnSpan ?? 1;
    column = current.column + span;
  }
  const clamped = clampPosition(row, column, bounds);
  const next = resolvePosition(merged, clamped.row, clamped.column);
  return {
    anchor: extend ? selection.anchor : next,
    active: next,
  };
}

/** Home/End jump within the row; Ctrl+Home/Ctrl+End jump to the first/last used cell. */
export function moveToEdge(
  selection: GridSelection,
  edge: 'home' | 'end' | 'first-cell' | 'last-cell',
  bounds: GridBounds,
  merged: MergedCellMap,
  extend: boolean,
): GridSelection {
  const current = resolvePosition(merged, selection.active.row, selection.active.column);
  let next: GridPosition;
  if (edge === 'home') next = { row: current.row, column: 0 };
  else if (edge === 'end') next = { row: current.row, column: Math.max(0, bounds.columnCount - 1) };
  else if (edge === 'first-cell') next = { row: 0, column: 0 };
  else next = { row: Math.max(0, bounds.rowCount - 1), column: Math.max(0, bounds.columnCount - 1) };
  const clamped = clampPosition(next.row, next.column, bounds);
  next = resolvePosition(merged, clamped.row, clamped.column);
  return {
    anchor: extend ? selection.anchor : next,
    active: next,
  };
}

/** PageUp/PageDown move by the visible page, keeping the column. */
export function movePage(
  selection: GridSelection,
  direction: 'up' | 'down',
  pageSize: number,
  bounds: GridBounds,
  merged: MergedCellMap,
  extend: boolean,
): GridSelection {
  const current = resolvePosition(merged, selection.active.row, selection.active.column);
  const step = Math.max(1, pageSize);
  const clamped = clampPosition(
    current.row + (direction === 'down' ? step : -step),
    current.column,
    bounds,
  );
  const next = resolvePosition(merged, clamped.row, clamped.column);
  return {
    anchor: extend ? selection.anchor : next,
    active: next,
  };
}

/** A1-style reference for a 0-based position: { row: 1, column: 1 } -> "B2". */
export function cellReference(row: number, column: number): string {
  return `${columnLabel(column)}${row + 1}`;
}

/**
 * The accessible name for a cell, in the same words the old per-cell
 * inputs used: "Row 1, column A, Rent" or "Row 1, column B, formula,
 * 1500". A merged anchor adds how far it spans.
 */
export function describeCell(
  row: number,
  column: number,
  cell: SpreadsheetCell | undefined,
  merged: MergedCellMap,
): string {
  const span = mergedRangeAt(merged, row, column);
  const mergeNote =
    span === undefined
      ? ''
      : span.rowSpan > 1 && span.columnSpan > 1
        ? `, merged across ${span.columnSpan} columns and ${span.rowSpan} rows`
        : span.columnSpan > 1
          ? `, merged across ${span.columnSpan} columns`
          : span.rowSpan > 1
            ? `, merged across ${span.rowSpan} rows`
            : '';
  return `Row ${row + 1}, column ${columnLabel(column)}${mergeNote}${cell?.formula ? ', formula' : ''}, ${cell?.text || 'empty'}`;
}

/** Plain-language selection: "B2", or "B2 to D4, 3 rows by 3 columns". */
export function describeSelection(selection: GridSelection): string {
  const range = normalizeSelection(selection);
  const rows = range.endRow - range.startRow + 1;
  const columns = range.endColumn - range.startColumn + 1;
  if (rows === 1 && columns === 1) return cellReference(range.startRow, range.startColumn);
  return `${cellReference(range.startRow, range.startColumn)} to ${cellReference(range.endRow, range.endColumn)}, ${rows} ${rows === 1 ? 'row' : 'rows'} by ${columns} ${columns === 1 ? 'column' : 'columns'}`;
}
