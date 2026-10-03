import { useEffect, useRef, useState } from 'react';
import { moveGridFocus, serializeCsv, serializeGridMarkdown, sortGrid, type GridData } from '../../../shared/assets';

export interface GridEditorProps {
  value: GridData;
  onChange: (value: GridData) => void;
  onSave?: (source: string, format: 'csv' | 'markdown') => void;
  readOnly?: boolean;
}

export default function GridEditor({ value, onChange, onSave, readOnly = false }: GridEditorProps) {
  const [active, setActive] = useState({ row: 0, column: 0 });
  const [editing, setEditing] = useState<{ row: number; column: number; text: string }>();
  const [sort, setSort] = useState<{ column: number; direction: 'ascending' | 'descending' }>();
  const [format, setFormat] = useState<'csv' | 'markdown'>('csv');
  const cells = useRef(new Map<string, HTMLTableCellElement>());
  const ignoreBlur = useRef(false);
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (readOnly) setEditing(undefined);
  }, [readOnly]);
  const position = moveGridFocus(active.row, active.column, '', value.rows.length + 1, value.columns.length);
  const key = (row: number, column: number) => `${row}:${column}`;
  useEffect(() => {
    if (pendingFocus.current) {
      cells.current.get(key(position.row, position.column))?.focus();
      pendingFocus.current = false;
    }
  }, [editing, position.row, position.column, value]);
  const focus = (row: number, column: number) => {
    setActive({ row, column });
    cells.current.get(key(row, column))?.focus();
  };
  const change = (next: GridData) => {
    setSort(undefined);
    onChange(next);
  };
  const commit = () => {
    if (!editing || readOnly) return;
    const next = { columns: [...value.columns], rows: value.rows.map((row) => [...row]) };
    if (editing.row === 0) next.columns[editing.column] = editing.text;
    else if (next.rows[editing.row - 1]) next.rows[editing.row - 1][editing.column] = editing.text;
    change(next);
    setEditing(undefined);
  };
  const sortColumn = (column: number) => {
    if (readOnly) return;
    const direction = sort?.column === column && sort.direction === 'ascending' ? 'descending' : 'ascending';
    setSort({ column, direction });
    onChange(sortGrid(value, column, direction));
  };
  const renderCell = (text: string, row: number, column: number) => {
    const Component = row === 0 ? 'th' : 'td';
    const isEditing = !readOnly && editing?.row === row && editing.column === column;
    return (
      <Component
        key={column}
        role={row === 0 ? 'columnheader' : 'gridcell'}
        scope={row === 0 ? 'col' : undefined}
        aria-colindex={column + 1}
        aria-label={row === 0 ? `Column ${column + 1}: ${text || 'Empty'}` : undefined}
        aria-sort={row === 0 ? (sort?.column === column ? sort.direction : 'none') : undefined}
        ref={(element) => {
          if (element) cells.current.set(key(row, column), element);
          else cells.current.delete(key(row, column));
        }}
        tabIndex={position.row === row && position.column === column ? 0 : -1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setActive({ row, column });
        }}
        onClick={() => {
          if (!isEditing) focus(row, column);
        }}
        onKeyDown={(event) => {
          if (isEditing || event.target !== event.currentTarget) return;
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            const next = moveGridFocus(row, column, event.key, value.rows.length + 1, value.columns.length);
            focus(next.row, next.column);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            focus(
              event.ctrlKey ? (event.key === 'Home' ? 0 : value.rows.length) : row,
              event.key === 'Home' ? 0 : value.columns.length - 1,
            );
          } else if ((event.key === 'Enter' || event.key === 'F2') && !readOnly) {
            event.preventDefault();
            ignoreBlur.current = false;
            setEditing({ row, column, text });
          } else if (event.key === ' ' && row === 0) {
            event.preventDefault();
            sortColumn(column);
          }
        }}
      >
        {isEditing ? (
          <textarea
            autoFocus
            rows={2}
            aria-label={`Edit row ${row === 0 ? 'header' : row}, column ${column + 1}`}
            value={editing.text}
            onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            onBlur={() => {
              if (!ignoreBlur.current) commit();
              ignoreBlur.current = false;
            }}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
                event.preventDefault();
                ignoreBlur.current = true;
                pendingFocus.current = true;
                if (event.key === 'Enter') commit();
                else setEditing(undefined);
              }
              event.stopPropagation();
            }}
          />
        ) : row === 0 ? (
          <>
            {text || 'Empty'}
            {!readOnly && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Sort column ${column + 1}: ${text || 'Empty'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  sortColumn(column);
                }}
              >
                Sort
              </button>
            )}
          </>
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>{text || '\u00a0'}</span>
        )}
      </Component>
    );
  };
  return (
    <section aria-label="Grid editor">
      <p>
        Arrow keys move between cells. Enter edits or saves an edit; Shift+Enter adds a line, Escape cancels. Space
        sorts a header.
      </p>
      <table
        role="grid"
        aria-label="Editable grid"
        aria-readonly={readOnly}
        aria-rowcount={value.rows.length + 1}
        aria-colcount={value.columns.length}
      >
        <thead>
          <tr role="row" aria-rowindex={1}>
            {value.columns.map((text, column) => renderCell(text, 0, column))}
          </tr>
        </thead>
        <tbody>
          {value.rows.map((row, index) => (
            <tr key={index} role="row" aria-rowindex={index + 2}>
              {row.map((text, column) => renderCell(text, index + 1, column))}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div>
          <button
            type="button"
            onClick={() => change({ ...value, rows: [...value.rows, value.columns.map(() => '')] })}
          >
            Add row
          </button>
          <button
            type="button"
            disabled={position.row === 0}
            onClick={() => {
              change({ ...value, rows: value.rows.filter((_, index) => index !== position.row - 1) });
              setActive({ ...position, row: Math.max(0, position.row - 1) });
            }}
          >
            Delete selected row
          </button>
          <button
            type="button"
            onClick={() =>
              change({
                columns: [...value.columns, `Column ${value.columns.length + 1}`],
                rows: value.rows.map((row) => [...row, '']),
              })
            }
          >
            Add column
          </button>
          <button
            type="button"
            disabled={value.columns.length <= 1}
            onClick={() => {
              change({
                columns: value.columns.filter((_, index) => index !== position.column),
                rows: value.rows.map((row) => row.filter((_, index) => index !== position.column)),
              });
              setActive({ ...position, column: Math.max(0, position.column - 1) });
            }}
          >
            Delete selected column
          </button>
          {onSave && (
            <>
              <label>
                Grid save format
                <select value={format} onChange={(event) => setFormat(event.target.value as 'csv' | 'markdown')}>
                  <option value="csv">CSV</option>
                  <option value="markdown">Markdown</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => onSave(format === 'csv' ? serializeCsv(value) : serializeGridMarkdown(value), format)}
              >
                Save grid
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
