import { useRef, useState } from 'react';
import CalendarGrid from './CalendarGrid';

/**
 * A typed date field with a "Show Date Picker" button. Typing stays in a
 * plain text field (YYYY-MM-DD), which screen readers handle reliably.
 * The button opens an in-dialog calendar grid (never the browser's
 * native date popup: that popup is browser UI outside the dialog, so
 * Tab cycles inside it instead of moving to the next dialog control,
 * and its date segments announce poorly). The grid uses roving
 * tabIndex, so it costs one Tab stop and arrow keys move between days;
 * picking a date writes it back into the text field and returns focus
 * there, and closing the grid returns focus to the button.
 */
export default function DatePickerField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [showCalendar, setShowCalendar] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const calendarId = `${id}-calendar`;

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        ref={textRef}
        id={id}
        type="text"
        placeholder="YYYY-MM-DD"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-expanded={showCalendar}
        aria-controls={showCalendar ? calendarId : undefined}
        onClick={() => setShowCalendar((current) => !current)}
      >
        Show Date Picker
      </button>
      {showCalendar && !disabled && (
        <CalendarGrid
          id={calendarId}
          label={label}
          value={value}
          onSelect={(date) => {
            onChange(date);
            setShowCalendar(false);
            textRef.current?.focus();
          }}
          onClose={() => {
            setShowCalendar(false);
            buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
