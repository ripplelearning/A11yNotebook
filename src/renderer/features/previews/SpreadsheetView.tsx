import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  applyCellEdit,
  columnLabel,
  type SpreadsheetCell,
  type SpreadsheetWorkbook,
} from '../../../shared/spreadsheet';
import {
  buildMergedCellMap,
  clampPosition,
  describeCell,
  describeSelection,
  isCellInSelection,
  moveActive,
  movePage,
  moveToEdge,
  resolvePosition,
  selectionCellCount,
  type GridPosition,
  type GridSelection,
} from '../../../shared/spreadsheet-grid';

export interface SpreadsheetSheetApi {
  /** Switch to the next sheet, wrapping around. False when no spreadsheet is open. */
  nextSheet: () => boolean;
  /** Switch to the previous sheet, wrapping around. False when no spreadsheet is open. */
  previousSheet: () => boolean;
}

interface Props {
  path: string;
  announce: (message: string) => void;
  /** App's Ctrl+S calls the save function registered here. */
  spreadsheetSaveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** The open spreadsheet registers its sheet-switching API here; see SpreadsheetSheetApi. */
  spreadsheetSheetRef?: MutableRefObject<SpreadsheetSheetApi | null>;
  /** Called with the new path after an .xls file is saved as .xlsx. */
  onFileCreated?: (relativePath: string) => void;
}

function copyWorkbook(workbook: SpreadsheetWorkbook): SpreadsheetWorkbook {
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => row.map((cell) => ({ ...cell }))),
      mergedCells: [...sheet.mergedCells],
      columnWidths: sheet.columnWidths.map((entry) => ({ ...entry })),
    })),
  };
}

const FIRST_CELL: GridSelection = {
  anchor: { row: 0, column: 0 },
  active: { row: 0, column: 0 },
};

export default function SpreadsheetView({ path, announce, spreadsheetSaveRef, spreadsheetSheetRef, onFileCreated }: Props) {
  const [workbook, setWorkbook] = useState<SpreadsheetWorkbook | null>(null);
  const [error, setError] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<GridSelection>(FIRST_CELL);
  const [editing, setEditing] = useState<GridPosition | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const workbookRef = useRef<SpreadsheetWorkbook | null>(null);
  workbookRef.current = workbook;
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const editorRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridHasFocusRef = useRef(false);
  const pendingFocusRef = useRef(false);
  const editingRef = useRef<GridPosition | null>(null);

  useEffect(() => {
    let cancelled = false;
    const vault = window.a11yNotebook?.vault;
    if (!vault) {
      setError('The local spreadsheet reader is unavailable.');
      return;
    }
    void vault
      .readSpreadsheet(path)
      .then((loaded) => {
        if (cancelled) return;
        setWorkbook(loaded);
        setSheetIndex(0);
        setSelection(FIRST_CELL);
        setEditing(null);
        editingRef.current = null;
        setDirty(false);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'This spreadsheet could not be read.');
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const save = useCallback(async () => {
    const current = workbookRef.current;
    if (!current || !dirty || saving) return;
    setSaving(true);
    try {
      if (current.sourceFormat === 'xls') {
        const created = await window.a11yNotebook!.vault.saveSpreadsheetAsXlsx(path, current);
        setDirty(false);
        announce(`Saved as ${created.split('/').at(-1)}. The original .xls file is unchanged.`);
        onFileCreated?.(created);
      } else {
        await window.a11yNotebook!.vault.saveSpreadsheet(path, current);
        setDirty(false);
        announce(`Saved ${path.split('/').at(-1)}.`);
      }
    } catch (reason) {
      announce(
        reason instanceof Error ? `Could not save the spreadsheet. ${reason.message}` : 'Could not save the spreadsheet.',
      );
    } finally {
      setSaving(false);
    }
  }, [announce, dirty, onFileCreated, path, saving]);

  useEffect(() => {
    if (!spreadsheetSaveRef) return;
    spreadsheetSaveRef.current = save;
    return () => {
      spreadsheetSaveRef.current = null;
    };
  }, [save, spreadsheetSaveRef]);

  const sheet = workbook?.sheets[sheetIndex];
  const merged = useMemo(() => buildMergedCellMap(sheet?.mergedCells ?? []), [sheet?.mergedCells]);
  const columnCount = sheet ? sheet.rows.reduce((max, row) => Math.max(max, row.length), 0) : 0;
  const rowCount = sheet ? sheet.rows.length : 0;

  const normalizeSelectionValue = useCallback(
    (value: GridSelection): GridSelection => {
      const bounds = { rowCount, columnCount };
      const anchor = clampPosition(value.anchor.row, value.anchor.column, bounds);
      const active = clampPosition(value.active.row, value.active.column, bounds);
      return {
        anchor: resolvePosition(merged, anchor.row, anchor.column),
        active: resolvePosition(merged, active.row, active.column),
      };
    },
    [rowCount, columnCount, merged],
  );

  // Row and column deletes can leave the selection past the end of the
  // sheet, or on a cell a merge now covers: pull it back in bounds.
  useEffect(() => {
    setSelection((prev) => {
      const normalized = normalizeSelectionValue(prev);
      if (
        normalized.anchor.row === prev.anchor.row &&
        normalized.anchor.column === prev.anchor.column &&
        normalized.active.row === prev.active.row &&
        normalized.active.column === prev.active.column
      )
        return prev;
      return normalized;
    });
  }, [rowCount, columnCount, normalizeSelectionValue]);

  // A new sheet always starts at A1.
  useEffect(() => {
    setSelection(FIRST_CELL);
    setEditing(null);
    editingRef.current = null;
  }, [sheetIndex]);

  // Keep DOM focus on the active cell while the grid owns focus: arrow
  // moves, commits, and sheet switches all land there. The editor input
  // manages its own focus while it is open.
  useEffect(() => {
    if (editing) return;
    if (!gridHasFocusRef.current && !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    cellRefs.current.get(`${selection.active.row}:${selection.active.column}`)?.focus();
  }, [selection, editing]);

  // The editor input takes focus when it opens, caret at the end.
  useEffect(() => {
    if (!editing) return;
    const input = editorRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  const applySelection = useCallback(
    (next: GridSelection, announceRange: boolean) => {
      const normalized = normalizeSelectionValue(next);
      setSelection(normalized);
      if (announceRange && selectionCellCount(normalized) > 1) announce(describeSelection(normalized));
    },
    [announce, normalizeSelectionValue],
  );

  const beginEdit = (row: number, column: number, initialText?: string) => {
    const cell = sheet?.rows[row]?.[column];
    editingRef.current = { row, column };
    setEditing({ row, column });
    setEditText(initialText ?? cell?.text ?? '');
  };

  const commitEdit = (move: 'stay' | 'down' | 'up' | GridPosition) => {
    const target = editingRef.current;
    if (!target || !sheet) return;
    editingRef.current = null;
    setEditing(null);
    const { row, column } = target;
    const text = editText;
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const targetSheet = next.sheets[sheetIndex];
      if (!targetSheet) return current;
      while (targetSheet.rows.length <= row) targetSheet.rows.push([]);
      const targetRow = targetSheet.rows[row];
      if (!targetRow) return current;
      while (targetRow.length <= column) targetRow.push({ text: '' });
      targetRow[column] = applyCellEdit(targetRow[column] ?? { text: '' }, text);
      return next;
    });
    setDirty(true);
    pendingFocusRef.current = true;
    if (move === 'stay') return;
    const next =
      move === 'down' || move === 'up'
        ? moveActive(
            { anchor: { row, column }, active: { row, column } },
            move,
            { rowCount, columnCount },
            merged,
            false,
          ).active
        : move;
    applySelection({ anchor: next, active: next }, false);
  };

  // Tab wraps to the next row's first cell (or the previous row's last
  // cell going backward); the callers let Tab leave the grid at the
  // very last and first cells instead.
  const tabTarget = (row: number, column: number, forward: boolean): GridPosition => {
    if (forward) {
      if (column < columnCount - 1) return { row, column: column + 1 };
      if (row < rowCount - 1) return { row: row + 1, column: 0 };
      return { row, column };
    }
    if (column > 0) return { row, column: column - 1 };
    if (row > 0) return { row: row - 1, column: columnCount - 1 };
    return { row, column };
  };

  const cancelEdit = () => {
    if (!editingRef.current) return;
    editingRef.current = null;
    setEditing(null);
    pendingFocusRef.current = true;
  };

  const switchSheet = (delta: number): boolean => {
    const current = workbookRef.current;
    if (!current) return false;
    if (current.sheets.length < 2) {
      announce('This workbook has only one sheet.');
      return true;
    }
    commitEdit('stay');
    const next = (sheetIndex + delta + current.sheets.length) % current.sheets.length;
    const target = current.sheets[next];
    if (!target) return false;
    setSheetIndex(next);
    announce(`Sheet ${target.name}.`);
    return true;
  };

  const nextSheet = () => switchSheet(1);
  const previousSheet = () => switchSheet(-1);

  // The latest closures for the sheet API the app calls through the ref:
  // the ref object itself is registered once, so it must read through here.
  const apiRef = useRef({ commitEdit, nextSheet, previousSheet });
  apiRef.current = { commitEdit, nextSheet, previousSheet };

  useEffect(() => {
    if (!spreadsheetSheetRef) return;
    spreadsheetSheetRef.current = {
      nextSheet: () => apiRef.current.nextSheet(),
      previousSheet: () => apiRef.current.previousSheet(),
    };
    return () => {
      spreadsheetSheetRef.current = null;
    };
  }, [spreadsheetSheetRef]);

  const pageSize = () => {
    const container = scrollRef.current;
    const activeEl = cellRefs.current.get(`${selection.active.row}:${selection.active.column}`);
    const rowHeight = activeEl?.offsetHeight ?? 0;
    if (!container || rowHeight <= 0) return 10;
    return Math.max(1, Math.floor(container.clientHeight / rowHeight));
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    // The editor input handles its own keys while it is open.
    if (editing || !sheet) return;
    const bounds = { rowCount, columnCount };
    const extend = event.shiftKey;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowLeft' ? 'left' : 'right';
        applySelection(moveActive(selection, direction, bounds, merged, extend), extend);
        break;
      }
      case 'Home':
      case 'End': {
        event.preventDefault();
        const edge =
          event.ctrlKey || event.metaKey ? (event.key === 'Home' ? 'first-cell' : 'last-cell') : event.key === 'Home' ? 'home' : 'end';
        applySelection(moveToEdge(selection, edge, bounds, merged, extend), extend);
        break;
      }
      case 'PageUp':
      case 'PageDown': {
        // Ctrl+PageUp/PageDown switch sheets (a registry command): let
        // those reach the app handler instead of moving a page here.
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        applySelection(movePage(selection, event.key === 'PageDown' ? 'down' : 'up', pageSize(), bounds, merged, extend), extend);
        break;
      }
      case 'Enter': {
        // Enter moves down, committing first when an edit is open; the
        // editor input handles the committing case itself.
        event.preventDefault();
        applySelection(moveActive(selection, 'down', bounds, merged, false), false);
        break;
      }
      case 'F2': {
        event.preventDefault();
        beginEdit(selection.active.row, selection.active.column);
        break;
      }
      case 'Tab': {
        // Ctrl+Tab cycles tabs (a registry command): let it reach the app
        // handler instead of moving within the grid.
        if (event.ctrlKey || event.metaKey) return;
        // Tab moves within the grid, except at the edges, where it leaves
        // the grid the way Tab normally does: forward from the last cell,
        // backward from the first.
        const last = selection.active.row === rowCount - 1 && selection.active.column === columnCount - 1;
        const first = selection.active.row === 0 && selection.active.column === 0;
        if ((!event.shiftKey && last) || (event.shiftKey && first)) return;
        event.preventDefault();
        const next = tabTarget(selection.active.row, selection.active.column, !event.shiftKey);
        applySelection({ anchor: next, active: next }, false);
        break;
      }
      default: {
        // Typing a character starts editing with that character.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          beginEdit(selection.active.row, selection.active.column, event.key);
        }
        break;
      }
    }
  };

  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!editing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit(event.shiftKey ? 'up' : 'down');
    } else if (event.key === 'Tab') {
      // Ctrl+Tab cycles tabs: let it reach the app handler.
      if (event.ctrlKey || event.metaKey) return;
      const last = editing.row === rowCount - 1 && editing.column === columnCount - 1;
      const first = editing.row === 0 && editing.column === 0;
      // At the edges Tab leaves the editor and the blur commits the edit.
      if ((!event.shiftKey && last) || (event.shiftKey && first)) return;
      event.preventDefault();
      commitEdit(tabTarget(editing.row, editing.column, !event.shiftKey));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const onCellClick = (row: number, column: number, event: React.MouseEvent) => {
    const next = event.shiftKey
      ? { anchor: selection.anchor, active: { row, column } }
      : { anchor: { row, column }, active: { row, column } };
    applySelection(next, event.shiftKey);
    cellRefs.current.get(`${row}:${column}`)?.focus();
  };

  const addRow = () => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const rows = next.sheets[sheetIndex].rows;
      if (!rows) return current;
      const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
      rows.push(Array.from({ length: Math.max(width, 1) }, (): SpreadsheetCell => ({ text: '' })));
      return next;
    });
    setDirty(true);
    announce('Row added at the end of the sheet.');
  };

  const addColumn = () => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const targetSheet = next.sheets[sheetIndex];
      if (!targetSheet) return current;
      for (const row of targetSheet.rows) row.push({ text: '' });
      if (!targetSheet.rows.length) targetSheet.rows.push([{ text: '' }]);
      return next;
    });
    setDirty(true);
    announce('Column added at the end of the sheet.');
  };

  const deleteRow = () => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const rows = next.sheets[sheetIndex].rows;
      if (!rows || !rows.length) return current;
      rows.splice(Math.min(selection.active.row, rows.length - 1), 1);
      return next;
    });
    setDirty(true);
    announce(`Row ${selection.active.row + 1} deleted.`);
  };

  const deleteColumn = () => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const rows = next.sheets[sheetIndex].rows;
      if (!rows || !rows.some((row) => row.length > 0)) return current;
      const column = Math.min(selection.active.column, Math.max(...rows.map((row) => row.length)) - 1);
      for (const row of rows) row.splice(column, 1);
      return next;
    });
    setDirty(true);
    announce(`Column ${columnLabel(selection.active.column)} deleted.`);
  };

  if (error) return <p>{error}</p>;
  if (!workbook || !sheet) return <p>Loading spreadsheet…</p>;

  return (
    <div>
      <p>
        {workbook.sourceFormat === 'xls'
          ? 'This is an older .xls spreadsheet. Saving creates a new .xlsx file; the original is left unchanged.'
          : null}
        {workbook.truncated && workbook.truncationReason ? ` ${workbook.truncationReason}` : null}
      </p>
      {workbook.sheets.length > 1 ? (
        <p>
          <label>
            Sheet{' '}
            <select
              value={sheetIndex}
              onChange={(event) => {
                commitEdit('stay');
                setSheetIndex(Number(event.target.value));
              }}
            >
              {workbook.sheets.map((entry, index) => (
                <option key={entry.name + index} value={index}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </p>
      ) : null}
      <p>
        <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : workbook.sourceFormat === 'xls' ? 'Save as .xlsx (Ctrl+S)' : 'Save spreadsheet (Ctrl+S)'}
        </button>{' '}
        <button type="button" onClick={addRow}>
          Add row
        </button>{' '}
        <button type="button" onClick={addColumn}>
          Add column
        </button>{' '}
        <button type="button" onClick={deleteRow} disabled={!sheet.rows.length}>
          Delete row {selection.active.row + 1}
        </button>{' '}
        <button type="button" onClick={deleteColumn} disabled={columnCount === 0}>
          Delete column {columnLabel(selection.active.column)}
        </button>
      </p>
      {dirty ? <p>Unsaved changes.</p> : null}
      <div
        className="table-scroll"
        ref={scrollRef}
        onFocusCapture={() => {
          gridHasFocusRef.current = true;
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) gridHasFocusRef.current = false;
        }}
      >
        <table role="grid" aria-label={`${sheet.name} — ${sheet.rows.length} ${sheet.rows.length === 1 ? 'row' : 'rows'}`} onKeyDown={onGridKeyDown}>
          <caption>
            {sheet.name} — {sheet.rows.length} {sheet.rows.length === 1 ? 'row' : 'rows'}
          </caption>
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader">
                <span className="visually-hidden">Row</span>
              </th>
              {Array.from({ length: columnCount }, (_, column) => (
                <th scope="col" role="columnheader" key={column}>
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex} role="row">
                <th scope="row" role="rowheader">
                  {rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  if (merged.covered.has(`${rowIndex}:${columnIndex}`)) return null;
                  const cell = row[columnIndex];
                  const span = merged.anchors.get(`${rowIndex}:${columnIndex}`);
                  const inSelection = isCellInSelection(selection, rowIndex, columnIndex);
                  const isActive = selection.active.row === rowIndex && selection.active.column === columnIndex;
                  const label = describeCell(rowIndex, columnIndex, cell, merged);
                  const isEditing = editing?.row === rowIndex && editing?.column === columnIndex;
                  return (
                    <td
                      key={columnIndex}
                      role="gridcell"
                      tabIndex={isActive ? 0 : -1}
                      aria-selected={inSelection}
                      aria-label={label}
                      colSpan={span?.columnSpan}
                      rowSpan={span?.rowSpan}
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${rowIndex}:${columnIndex}`, el);
                        else cellRefs.current.delete(`${rowIndex}:${columnIndex}`);
                      }}
                      onClick={(event) => onCellClick(rowIndex, columnIndex, event)}
                      onDoubleClick={() => beginEdit(rowIndex, columnIndex)}
                    >
                      {isEditing ? (
                        <input
                          ref={editorRef}
                          aria-label={label}
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          onKeyDown={onEditorKeyDown}
                          onBlur={() => commitEdit('stay')}
                        />
                      ) : (
                        cell?.text ?? ''
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
