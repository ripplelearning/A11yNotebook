import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * An in-dialog calendar grid: the date picker's alternative to the
 * browser's native date popup. The native popup is browser UI outside
 * the dialog, so Tab cycles inside it instead of moving to the next
 * dialog control, and its date segments announce poorly in screen
 * readers. This grid lives inside the dialog DOM, so Tab passes
 * through it like any other control, and it uses roving tabIndex:
 * one tab stop for the whole grid, arrow keys move between days.
 */

interface ParsedDate {
  y: number;
  m: number;
  d: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function parseCalendarDate(value: string): ParsedDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? { y, m, d } : null;
}

export function formatCalendarDate(date: ParsedDate): string {
  return `${date.y}-${String(date.m + 1).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function shiftMonth(date: ParsedDate, delta: number): ParsedDate {
  const next = new Date(date.y, date.m + delta, 1);
  return { y: next.getFullYear(), m: next.getMonth(), d: 1 };
}

export default function CalendarGrid({
  id,
  label,
  value,
  onSelect,
  onClose,
}: {
  id: string;
  label: string;
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const selected = parseCalendarDate(value);
  const [view, setView] = useState<ParsedDate>(() =>
    selected ? { y: selected.y, m: selected.m, d: 1 } : { y: today.getFullYear(), m: today.getMonth(), d: 1 },
  );
  const [focused, setFocused] = useState<ParsedDate>(() => {
    if (selected && selected.y === view.y && selected.m === view.m) return selected;
    if (today.getFullYear() === view.y && today.getMonth() === view.m) {
      return { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
    }
    return { y: view.y, m: view.m, d: 1 };
  });
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${formatCalendarDate(focused)}"]`)?.focus();
  }, [focused, view]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const totalDays = daysInMonth(view.y, view.m);
  const cells: (ParsedDate | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => ({ y: view.y, m: view.m, d: index + 1 })),
  ];

  function moveFocus(delta: number) {
    const next = new Date(focused.y, focused.m, focused.d + delta);
    const candidate = { y: next.getFullYear(), m: next.getMonth(), d: next.getDate() };
    setFocused(candidate);
    if (candidate.y !== view.y || candidate.m !== view.m) setView({ y: candidate.y, m: candidate.m, d: 1 });
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-7);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(7);
        break;
      case 'Home':
        event.preventDefault();
        setFocused({ y: focused.y, m: focused.m, d: focused.d - new Date(focused.y, focused.m, focused.d).getDay() });
        break;
      case 'End': {
        event.preventDefault();
        const weekday = new Date(focused.y, focused.m, focused.d).getDay();
        setFocused({ y: focused.y, m: focused.m, d: Math.min(focused.d + (6 - weekday), daysInMonth(focused.y, focused.m)) });
        break;
      }
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  }

  return (
    <div id={id} className="calendar-grid" role="group" aria-label={`Calendar for ${label}`}>
      <p aria-live="polite">
        {MONTHS[view.m]} {view.y}
      </p>
      <button type="button" onClick={() => setView((current) => shiftMonth(current, -1))}>
        Previous month
      </button>
      <button type="button" onClick={() => setView((current) => shiftMonth(current, 1))}>
        Next month
      </button>
      <button
        type="button"
        onClick={() => {
          const now = new Date();
          setView({ y: now.getFullYear(), m: now.getMonth(), d: 1 });
          setFocused({ y: now.getFullYear(), m: now.getMonth(), d: now.getDate() });
        }}
      >
        Today
      </button>
      <div ref={gridRef} role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`} onKeyDown={onGridKeyDown}>
        <div role="row">
          {WEEKDAYS.map((day) => (
            <div key={day} role="columnheader" aria-label={day}>
              {day.slice(0, 2)}
            </div>
          ))}
        </div>
        {Array.from({ length: Math.ceil(cells.length / 7) }, (_, row) => (
          <div key={row} role="row">
            {cells.slice(row * 7, row * 7 + 7).map((cell, index) => {
              if (!cell) return <div key={`blank-${index}`} role="gridcell" aria-hidden="true" />;
              const key = formatCalendarDate(cell);
              const isFocused = focused.y === cell.y && focused.m === cell.m && focused.d === cell.d;
              const isSelected = selected?.y === cell.y && selected?.m === cell.m && selected?.d === cell.d;
              const isToday =
                today.getFullYear() === cell.y && today.getMonth() === cell.m && today.getDate() === cell.d;
              const labelParts = [`${MONTHS[cell.m]} ${cell.d}, ${cell.y}`];
              if (isSelected) labelParts.push('selected');
              if (isToday) labelParts.push('today');
              return (
                <div key={key} role="gridcell">
                  <button
                    type="button"
                    data-date={key}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={labelParts.join(', ')}
                    onFocus={() => setFocused(cell)}
                    onClick={() => onSelect(key)}
                  >
                    {cell.d}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <button type="button" onClick={onClose}>
        Close calendar
      </button>
    </div>
  );
}
