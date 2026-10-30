import { useRef } from 'react';

/**
 * A typed date field with a "Show Date Picker" button. Typing stays in a
 * plain text field (YYYY-MM-DD), which screen readers handle reliably;
 * the button opens the browser's native calendar picker and writes the
 * chosen date back into the text field. The native input is kept out of
 * the tab order and off-screen (never display:none, which would disable
 * its picker), and focus returns to the text field after a pick so the
 * user lands back where they were typing.
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
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const nativeValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';

  function showPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    const withPicker = picker as HTMLInputElement & { showPicker?: () => void };
    if (typeof withPicker.showPicker === 'function') withPicker.showPicker();
    else picker.focus();
  }

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
      <button type="button" disabled={disabled} onClick={showPicker} aria-label={`Show date picker for ${label}`}>
        Show Date Picker
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-label={`${label} calendar picker`}
        disabled={disabled}
        value={nativeValue}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
          textRef.current?.focus();
        }}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
    </>
  );
}
