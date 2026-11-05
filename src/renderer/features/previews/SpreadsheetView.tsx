import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  applyCellEdit,
  columnLabel,
  parseCellReference,
  type SpreadsheetCell,
  type SpreadsheetWorkbook,
} from '../../../shared/spreadsheet';

interface Props {
  path: string;
  announce: (message: string) => void;
  /** App's Ctrl+S calls the save function registered here. */
  spreadsheetSaveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Called with the new path after an .xls file is saved as .xlsx. */
  onFileCreated?: (relativePath: string) => void;
}

function coveredCells(mergedCells: string[]): Set<string> {
  const covered = new Set<string>();
  for (const range of mergedCells) {
    const [start, end] = range.split(':');
    const from = parseCellReference(start);
    const to = end ? parseCellReference(end) : from;
    if (!from || !to) continue;
    for (let row = from.row; row <= to.row; row += 1) {
      for (let column = from.column; column <= to.column; column += 1) {
        if (row !== from.row || column !== from.column) covered.add(`${row}:${column}`);
      }
    }
  }
  return covered;
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

export default function SpreadsheetView({ path, announce, spreadsheetSaveRef, onFileCreated }: Props) {
  const [workbook, setWorkbook] = useState<SpreadsheetWorkbook | null>(null);
  const [error, setError] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [focusCell, setFocusCell] = useState({ row: 0, column: 0 });
  const [saving, setSaving] = useState(false);
  const workbookRef = useRef<SpreadsheetWorkbook | null>(null);
  workbookRef.current = workbook;

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
  const covered = sheet ? coveredCells(sheet.mergedCells) : new Set<string>();
  const columnCount = sheet ? sheet.rows.reduce((max, row) => Math.max(max, row.length), 0) : 0;

  const updateCellText = (row: number, column: number, text: string) => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const target = next.sheets[sheetIndex].rows[row]?.[column];
      if (!target) return current;
      target.text = text;
      return next;
    });
    setDirty(true);
  };

  const commitCell = (row: number, column: number) => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const target = next.sheets[sheetIndex].rows[row]?.[column];
      if (!target) return current;
      next.sheets[sheetIndex].rows[row][column] = applyCellEdit(target, target.text);
      return next;
    });
  };

  const addRow = () => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const rows = next.sheets[sheetIndex].rows;
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
      for (const row of next.sheets[sheetIndex].rows) row.push({ text: '' });
      if (!next.sheets[sheetIndex].rows.length) next.sheets[sheetIndex].rows.push([{ text: '' }]);
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
      if (!rows.length) return current;
      rows.splice(Math.min(focusCell.row, rows.length - 1), 1);
      return next;
    });
    setDirty(true);
    announce(`Row ${focusCell.row + 1} deleted.`);
  };

  const deleteColumn = () => {
    setWorkbook((current) => {
      if (!current) return current;
      const next = copyWorkbook(current);
      const rows = next.sheets[sheetIndex].rows;
      if (!rows.length || !rows.some((row) => row.length > 0)) return current;
      const column = Math.min(focusCell.column, Math.max(...rows.map((row) => row.length)) - 1);
      for (const row of rows) row.splice(column, 1);
      return next;
    });
    setDirty(true);
    announce(`Column ${columnLabel(focusCell.column)} deleted.`);
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
            <select value={sheetIndex} onChange={(event) => setSheetIndex(Number(event.target.value))}>
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
          Delete row {focusCell.row + 1}
        </button>{' '}
        <button type="button" onClick={deleteColumn} disabled={columnCount === 0}>
          Delete column {columnLabel(focusCell.column)}
        </button>
      </p>
      {dirty ? <p>Unsaved changes.</p> : null}
      <div className="table-scroll">
        <table>
          <caption>
            {sheet.name} — {sheet.rows.length} {sheet.rows.length === 1 ? 'row' : 'rows'}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Row</span>
              </th>
              {Array.from({ length: columnCount }, (_, column) => (
                <th scope="col" key={column}>
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row">{rowIndex + 1}</th>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const cell = row[columnIndex];
                  if (!cell) return <td key={columnIndex} />;
                  if (covered.has(`${rowIndex}:${columnIndex}`)) return <td key={columnIndex} />;
                  const label = `Row ${rowIndex + 1}, column ${columnLabel(columnIndex)}${cell.formula ? ', formula' : ''}, ${cell.text || 'empty'}`;
                  return (
                    <td key={columnIndex}>
                      <input
                        aria-label={label}
                        value={cell.text}
                        onFocus={() => setFocusCell({ row: rowIndex, column: columnIndex })}
                        onChange={(event) => updateCellText(rowIndex, columnIndex, event.target.value)}
                        onBlur={() => commitCell(rowIndex, columnIndex)}
                      />
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
