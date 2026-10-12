import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface DetailsColumn<T> {
  id: string;
  header: string;
  accessor: (item: T) => React.ReactNode;
  ariaValue?: (item: T) => string;
  sortValue?: (item: T) => string | number | boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

export interface DetailsViewProps<T> {
  id: string;
  ariaLabel: string;
  caption?: string;
  columns: DetailsColumn<T>[];
  items: T[];
  itemKey: (item: T) => string;
  selectedKey?: string;
  onSelect?: (item: T) => void;
  onActivate?: (item: T) => void;
  onRename?: (item: T) => void;
  onContextMenu?: (item: T, event: React.MouseEvent | React.KeyboardEvent) => void;
  onToggle?: (item: T) => void;
  emptyState?: React.ReactNode;
  defaultSortColumn?: string;
  defaultSortDirection?: 'ascending' | 'descending';
  dataContext?: string;
}

export function DetailsView<T>({
  id,
  ariaLabel,
  caption,
  columns,
  items,
  itemKey,
  selectedKey,
  onSelect,
  onActivate,
  onRename,
  onContextMenu,
  onToggle,
  emptyState,
  defaultSortColumn,
  defaultSortDirection = 'ascending',
  dataContext = 'details-item',
}: DetailsViewProps<T>) {
  const tableId = useId();
  const [sortCol, setSortCol] = useState<string | undefined>(defaultSortColumn ?? columns[0]?.id);
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>(defaultSortDirection);

  const [focusedRow, setFocusedRow] = useState<number>(0);
  const [focusedCol, setFocusedCol] = useState<number>(0);
  const [hasGridFocus, setHasGridFocus] = useState<boolean>(false);

  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  // Handle column sort
  const handleSort = (colId: string) => {
    if (sortCol === colId) {
      setSortDir((dir) => (dir === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortCol(colId);
      setSortDir('ascending');
    }
  };

  const sortedItems = useMemo(() => {
    if (!sortCol) return items;
    const colDef = columns.find((col) => col.id === sortCol);
    if (!colDef) return items;
    const getter = colDef.sortValue ?? ((item: T) => String(colDef.accessor(item)));

    return [...items].sort((a, b) => {
      const valA = getter(a);
      const valB = getter(b);
      let comp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        comp = valA - valB;
      } else if (typeof valA === 'boolean' && typeof valB === 'boolean') {
        comp = valA === valB ? 0 : valA ? 1 : -1;
      } else {
        comp = String(valA ?? '').localeCompare(String(valB ?? ''));
      }
      return sortDir === 'ascending' ? comp : -comp;
    });
  }, [items, sortCol, sortDir, columns]);

  // Keep focused row within range
  useEffect(() => {
    if (sortedItems.length === 0) {
      setFocusedRow(0);
      return;
    }
    if (focusedRow >= sortedItems.length) {
      setFocusedRow(sortedItems.length - 1);
    }
  }, [sortedItems.length, focusedRow]);

  // Sync selectedKey to focused row
  useEffect(() => {
    if (!selectedKey || sortedItems.length === 0) return;
    const index = sortedItems.findIndex((item) => itemKey(item) === selectedKey);
    if (index >= 0 && index !== focusedRow) {
      setFocusedRow(index);
    }
  }, [selectedKey, sortedItems, itemKey]);

  const focusCell = useCallback((row: number, col: number) => {
    setFocusedRow(row);
    setFocusedCol(col);
    const cellKey = `${row}:${col}`;
    const el = cellRefs.current.get(cellKey);
    if (el) {
      el.focus();
    }
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent, rowIdx: number, colIdx: number, item: T) => {
    if (sortedItems.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (rowIdx < sortedItems.length - 1) {
        const nextRow = rowIdx + 1;
        focusCell(nextRow, colIdx);
        onSelect?.(sortedItems[nextRow]);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (rowIdx > 0) {
        const prevRow = rowIdx - 1;
        focusCell(prevRow, colIdx);
        onSelect?.(sortedItems[prevRow]);
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (colIdx < columns.length - 1) {
        focusCell(rowIdx, colIdx + 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (colIdx > 0) {
        focusCell(rowIdx, colIdx - 1);
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      if (event.ctrlKey) {
        focusCell(0, 0);
        onSelect?.(sortedItems[0]);
      } else {
        focusCell(rowIdx, 0);
      }
    } else if (event.key === 'End') {
      event.preventDefault();
      if (event.ctrlKey) {
        const lastRow = sortedItems.length - 1;
        const lastCol = columns.length - 1;
        focusCell(lastRow, lastCol);
        onSelect?.(sortedItems[lastRow]);
      } else {
        focusCell(rowIdx, columns.length - 1);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onActivate?.(item);
    } else if (event.key === 'F2') {
      event.preventDefault();
      onRename?.(item);
    } else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      onContextMenu?.(item, event);
    } else if (event.key === ' ') {
      if (onToggle) {
        event.preventDefault();
        onToggle(item);
      }
    }
  };

  if (items.length === 0 && emptyState) {
    return <div className="details-view-empty">{emptyState}</div>;
  }

  return (
    <div className="table-scroll details-view-container" id={id}>
      <table
        id={tableId}
        role="grid"
        aria-label={ariaLabel}
        aria-rowcount={sortedItems.length + 1}
        aria-colcount={columns.length}
        className="details-grid"
      >
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr role="row" aria-rowindex={1}>
            {columns.map((col, colIdx) => {
              const isSorted = sortCol === col.id;
              const ariaSort = isSorted ? sortDir : 'none';
              return (
                <th
                  key={col.id}
                  role="columnheader"
                  scope="col"
                  aria-colindex={colIdx + 1}
                  aria-sort={ariaSort}
                  style={{ width: col.width, textAlign: col.align }}
                >
                  <button
                    type="button"
                    className="header-sort-button"
                    onClick={() => handleSort(col.id)}
                    aria-label={`${col.header}, sortable column, currently ${isSorted ? sortDir : 'not sorted'}`}
                  >
                    {col.header}
                    {isSorted ? (
                      <span aria-hidden="true" className="sort-indicator">
                        {sortDir === 'ascending' ? ' ▲' : ' ▼'}
                      </span>
                    ) : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, rowIdx) => {
            const key = itemKey(item);
            const isSelected = selectedKey === key || (focusedRow === rowIdx && hasGridFocus);
            const isRowFocused = focusedRow === rowIdx;

            return (
              <tr
                key={key}
                role="row"
                aria-rowindex={rowIdx + 2}
                aria-selected={isSelected}
                className={isSelected ? 'selected-row' : ''}
                data-context={dataContext}
                data-path={key}
                onContextMenu={(e) => onContextMenu?.(item, e)}
              >
                {columns.map((col, colIdx) => {
                  const isCurrentCell = isRowFocused && focusedCol === colIdx;
                  const cellContent = col.accessor(item);
                  const ariaVal = col.ariaValue?.(item);
                  const cellKey = `${rowIdx}:${colIdx}`;

                  return (
                    <td
                      key={col.id}
                      ref={(el) => {
                        if (el) cellRefs.current.set(cellKey, el);
                        else cellRefs.current.delete(cellKey);
                      }}
                      role="gridcell"
                      aria-colindex={colIdx + 1}
                      aria-label={ariaVal ? `${col.header}: ${ariaVal}` : undefined}
                      tabIndex={isCurrentCell ? 0 : -1}
                      style={{ textAlign: col.align }}
                      onFocus={() => {
                        setFocusedRow(rowIdx);
                        setFocusedCol(colIdx);
                        setHasGridFocus(true);
                        onSelect?.(item);
                      }}
                      onBlur={() => setHasGridFocus(false)}
                      onClick={() => {
                        focusCell(rowIdx, colIdx);
                        onSelect?.(item);
                      }}
                      onDoubleClick={() => onActivate?.(item)}
                      onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx, item)}
                    >
                      {cellContent}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
