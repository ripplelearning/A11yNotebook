import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { VaultEntry } from '../../shared/types';

type Column = 'name' | 'kind';
type Sort = { column: Column; direction: 'ascending' | 'descending' };

export interface DetailsViewProps {
  label: string;
  items: readonly VaultEntry[];
  selectedPath: string | null;
  onSelect: (entry: VaultEntry) => void;
  onOpen: (entry: VaultEntry) => void;
  onRename?: (entry: VaultEntry) => void;
  onContextMenu?: (entry: VaultEntry, invoker: HTMLElement, pointer?: { x: number; y: number }) => void;
  emptyMessage?: string;
}

const COLUMNS: readonly Column[] = ['name', 'kind'];
const CONTEXTS = {
  notebook: 'tree-folder',
  note: 'tree-note',
  attachment: 'attachment',
} as const;

const cellKey = (path: string, column: Column) => `${path}\0${column}`;

export default function DetailsView({
  label,
  items,
  selectedPath,
  onSelect,
  onOpen,
  onRename,
  onContextMenu,
  emptyMessage = 'No items to display.',
}: DetailsViewProps) {
  const [sort, setSort] = useState<Sort>({ column: 'name', direction: 'ascending' });
  const [focusedPath, setFocusedPath] = useState<string | null>(items[0]?.path ?? null);
  const [focusedColumn, setFocusedColumn] = useState<Column>('name');
  const cells = useRef(new Map<string, HTMLDivElement>());
  const grid = useRef<HTMLDivElement>(null);
  const gridHadFocus = useRef(false);
  const previousIndex = useRef(0);

  const sortedItems = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...items].sort((left, right) => {
      const first = sort.column === 'name' ? left.name : left.kind;
      const second = sort.column === 'name' ? right.name : right.kind;
      return (
        collator.compare(first, second) * (sort.direction === 'ascending' ? 1 : -1) ||
        left.path.localeCompare(right.path)
      );
    });
  }, [items, sort]);

  const foundIndex = sortedItems.findIndex((item) => item.path === focusedPath);
  const activeIndex = foundIndex >= 0 ? foundIndex : Math.min(previousIndex.current, sortedItems.length - 1);
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

  const select = (item: VaultEntry) => {
    setFocusedPath(item.path);
    onSelect(item);
  };

  const openContextMenu = (item: VaultEntry, invoker: HTMLElement, pointer?: { x: number; y: number }) => {
    if (!onContextMenu) return;
    select(item);
    onContextMenu(item, invoker, pointer);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: VaultEntry, index: number) => {
    const columnIndex = COLUMNS.indexOf(focusedColumn);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusCell(Math.min(index + 1, sortedItems.length - 1), focusedColumn);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusCell(Math.max(index - 1, 0), focusedColumn);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusCell(index, COLUMNS[Math.min(columnIndex + 1, COLUMNS.length - 1)]);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(index, COLUMNS[Math.max(columnIndex - 1, 0)]);
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        focusCell(
          event.ctrlKey ? (event.key === 'Home' ? 0 : sortedItems.length - 1) : index,
          event.key === 'Home' ? 'name' : 'kind',
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
      aria-colcount={COLUMNS.length}
      aria-multiselectable="false"
    >
      <div role="row" aria-rowindex={1}>
        {COLUMNS.map((column) => (
          <div
            key={column}
            role="columnheader"
            aria-colindex={COLUMNS.indexOf(column) + 1}
            aria-sort={sort.column === column ? sort.direction : 'none'}
          >
            <button type="button" onClick={() => toggleSort(column)}>
              {column === 'name' ? 'Name' : 'Type'}
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
            {COLUMNS.map((column, columnIndex) => (
              <div
                key={column}
                ref={(element) => {
                  const key = cellKey(item.path, column);
                  if (element) cells.current.set(key, element);
                  else cells.current.delete(key);
                }}
                role="gridcell"
                aria-colindex={columnIndex + 1}
                data-context={CONTEXTS[item.kind]}
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
                {column === 'name' ? item.name : item.kind}
              </div>
            ))}
          </div>
        ))
      ) : (
        <div role="row" aria-rowindex={2}>
          <div role="gridcell" aria-colspan={COLUMNS.length} tabIndex={0}>
            {emptyMessage}
          </div>
        </div>
      )}
    </div>
  );
}
