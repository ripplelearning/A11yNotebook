import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { VaultEntry } from '../../shared/types';

export interface DetailsViewItem {
  name: string;
  path: string;
  kind: string;
}

type Column = 'name' | 'kind' | 'path';
type Sort = { column: Column; direction: 'ascending' | 'descending' };

export interface DetailsViewProps<T extends DetailsViewItem = VaultEntry> {
  label: string;
  items: readonly T[];
  selectedPath: string | null;
  onSelect: (entry: T) => void;
  onOpen: (entry: T) => void;
  onRename?: (entry: T) => void;
  onDelete?: (entry: T) => void;
  onContextMenu?: (entry: T, invoker: HTMLElement, pointer?: { x: number; y: number }) => void;
  emptyMessage?: string;
  /** Columns to display; defaults to Name and Type, the notebooks and notes grids. */
  columns?: readonly Column[];
}

const DEFAULT_COLUMNS: readonly Column[] = ['name', 'kind'];
const CONTEXTS = {
  notebook: 'tree-folder',
  note: 'tree-note',
  attachment: 'attachment',
} as const;

const cellKey = (path: string, column: Column) => `${path}\0${column}`;

export default function DetailsView<T extends DetailsViewItem>({
  label,
  items,
  selectedPath,
  onSelect,
  onOpen,
  onRename,
  onDelete,
  onContextMenu,
  emptyMessage = 'No items to display.',
  columns = DEFAULT_COLUMNS,
}: DetailsViewProps<T>) {
  const [sort, setSort] = useState<Sort>({ column: 'name', direction: 'ascending' });
  const [focusedPath, setFocusedPath] = useState<string | null>(items[0]?.path ?? null);
  const [focusedColumn, setFocusedColumn] = useState<Column>('name');
  const cells = useRef(new Map<string, HTMLDivElement>());
  const headers = useRef(new Map<Column, HTMLDivElement>());
  const grid = useRef<HTMLDivElement>(null);
  const gridHadFocus = useRef(false);
  const previousIndex = useRef(0);

  const sortedItems = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const value = (item: T, column: Column) => (column === 'name' ? item.name : column === 'path' ? item.path : item.kind);
    return [...items].sort((left, right) => {
      const first = value(left, sort.column);
      const second = value(right, sort.column);
      return (
        collator.compare(first, second) * (sort.direction === 'ascending' ? 1 : -1) ||
        left.path.localeCompare(right.path)
      );
    });
  }, [items, sort]);

  const foundIndex = focusedPath ? sortedItems.findIndex((item) => item.path === focusedPath) : -1;
  const activeIndex =
    focusedPath === null ? -1 : foundIndex >= 0 ? foundIndex : Math.min(previousIndex.current, sortedItems.length - 1);
  const activeItem = activeIndex >= 0 ? sortedItems[activeIndex] : undefined;
  const activePath = activeItem?.path ?? null;

  useEffect(() => {
    if (activePath !== focusedPath) {
      setFocusedPath(activePath);
      if (gridHadFocus.current && activePath) {
        cells.current.get(cellKey(activePath, focusedColumn))?.focus();
      }
    }
    if (activeIndex >= 0) previousIndex.current = activeIndex;
  }, [activeIndex, activePath, focusedColumn, focusedPath]);

  useEffect(() => {
    const updateFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !grid.current?.contains(event.target)) {
        gridHadFocus.current = false;
      }
    };
    document.addEventListener('focusin', updateFocus);
    return () => document.removeEventListener('focusin', updateFocus);
  }, []);

  const focusCell = (index: number, column: Column) => {
    const item = sortedItems[index];
    if (!item) return;
    previousIndex.current = index;
    setFocusedPath(item.path);
    setFocusedColumn(column);
    cells.current.get(cellKey(item.path, column))?.focus();
  };

  const focusHeader = (column: Column) => {
    setFocusedPath(null);
    setFocusedColumn(column);
    headers.current.get(column)?.focus();
  };

  const select = (item: T) => {
    setFocusedPath(item.path);
    onSelect(item);
  };

  const openContextMenu = (item: T, invoker: HTMLElement, pointer?: { x: number; y: number }) => {
    if (!onContextMenu) return;
    select(item);
    onContextMenu(item, invoker, pointer);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: T, index: number) => {
    const columnIndex = columns.indexOf(focusedColumn);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusCell(Math.min(index + 1, sortedItems.length - 1), focusedColumn);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (index === 0) focusHeader(focusedColumn);
        else focusCell(index - 1, focusedColumn);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusCell(index, columns[Math.min(columnIndex + 1, columns.length - 1)] ?? focusedColumn);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(index, columns[Math.max(columnIndex - 1, 0)] ?? focusedColumn);
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        focusCell(
          event.ctrlKey ? (event.key === 'Home' ? 0 : sortedItems.length - 1) : index,
          event.key === 'Home' ? (columns[0] ?? 'name') : (columns[columns.length - 1] ?? 'kind'),
        );
        return;
      case 'Enter':
        event.preventDefault();
        onOpen(item);
        return;
      case 'F2':
        if (onRename) {
          event.preventDefault();
          onRename(item);
        }
        return;
      case 'Delete':
        if (onDelete) {
          event.preventDefault();
          onDelete(item);
        }
        return;
      case ' ':
        event.preventDefault();
        select(item);
        return;
      case 'ContextMenu':
      case 'F10':
        if (event.key === 'F10' && !event.shiftKey) return;
        if (onContextMenu) {
          event.preventDefault();
          event.stopPropagation();
          openContextMenu(item, event.currentTarget);
        }
        return;
      default:
    }
  };

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>, column: Column) => {
    const columnIndex = columns.indexOf(column);
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        focusHeader(columns[Math.max(columnIndex - 1, 0)] ?? column);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusHeader(columns[Math.min(columnIndex + 1, columns.length - 1)] ?? column);
        break;
      case 'ArrowDown':
        if (sortedItems.length) {
          event.preventDefault();
          focusCell(0, column);
        }
        break;
      case 'Home':
      case 'End':
        event.preventDefault();
        focusHeader(columns[event.key === 'Home' ? 0 : columns.length - 1] ?? column);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        toggleSort(column);
        break;
      default:
    }
  };

  const toggleSort = (column: Column) => {
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === 'ascending' ? 'descending' : 'ascending',
    }));
  };

  return (
    <div
      ref={grid}
      className="details-view"
      role="grid"
      aria-label={label}
      aria-rowcount={sortedItems.length + 1}
      aria-colcount={columns.length}
      aria-multiselectable="false"
    >
      <div role="row" aria-rowindex={1}>
        {columns.map((column) => (
          <div
            key={column}
            ref={(element) => {
              if (element) headers.current.set(column, element);
              else headers.current.delete(column);
            }}
            role="columnheader"
            aria-colindex={columns.indexOf(column) + 1}
            aria-sort={sort.column === column ? sort.direction : 'none'}
            tabIndex={focusedPath === null && focusedColumn === column ? 0 : -1}
            onFocus={() => {
              gridHadFocus.current = true;
              setFocusedPath(null);
              setFocusedColumn(column);
            }}
            onKeyDown={(event) => handleHeaderKeyDown(event, column)}
          >
            <button type="button" tabIndex={-1} onClick={() => toggleSort(column)}>
              {column === 'name' ? 'Name' : column === 'path' ? 'Path' : 'Type'}
            </button>
          </div>
        ))}
      </div>
      {sortedItems.length ? (
        sortedItems.map((item, index) => (
          <div
            key={item.path}
            role="row"
            aria-rowindex={index + 2}
            aria-selected={selectedPath === item.path}
            onContextMenu={(event) => {
              if (!onContextMenu) return;
              event.preventDefault();
              event.stopPropagation();
              const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
              openContextMenu(item, target, { x: event.clientX, y: event.clientY });
            }}
          >
            {columns.map((column, columnIndex) => (
              <div
                key={column}
                ref={(element) => {
                  const key = cellKey(item.path, column);
                  if (element) cells.current.set(key, element);
                  else cells.current.delete(key);
                }}
                role="gridcell"
                aria-colindex={columnIndex + 1}
                data-context={CONTEXTS[item.kind as keyof typeof CONTEXTS]}
                data-path={item.path}
                tabIndex={activePath === item.path && focusedColumn === column ? 0 : -1}
                onFocus={() => {
                  gridHadFocus.current = true;
                  previousIndex.current = index;
                  setFocusedPath(item.path);
                  setFocusedColumn(column);
                  select(item);
                }}
                onClick={(event) => {
                  previousIndex.current = index;
                  setFocusedPath(item.path);
                  setFocusedColumn(column);
                  if (event.currentTarget === document.activeElement) select(item);
                  else event.currentTarget.focus();
                }}
                onDoubleClick={() => onOpen(item)}
                onKeyDown={(event) => handleKeyDown(event, item, index)}
              >
                {column === 'name' ? item.name : column === 'path' ? item.path : item.kind}
              </div>
            ))}
          </div>
        ))
      ) : (
        <div role="row" aria-rowindex={2}>
          <div role="gridcell" aria-colspan={columns.length} tabIndex={-1}>
            {emptyMessage}
          </div>
        </div>
      )}
    </div>
  );
}
