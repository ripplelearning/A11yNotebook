import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DatePickerField from '../renderer/components/DatePickerField';

describe('DatePickerField', () => {
  it('types a date in text and offers a Show Date Picker button, with no native date input', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DatePickerField id="test-date" label="Start date" value="2026-10-30" onChange={onChange} />,
    );
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-30');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-02' } });
    expect(onChange).toHaveBeenCalledWith('2026-11-02');
    expect(screen.getByRole('button', { name: 'Show Date Picker' })).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('writes a picked date into the text field and returns focus there', () => {
    let value = '2026-11-01';
    const { rerender } = render(
      <DatePickerField id="test-date" label="Start date" value={value} onChange={(next) => (value = next)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Date Picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'November 5, 2026' }));
    expect(value).toBe('2026-11-05');
    rerender(<DatePickerField id="test-date" label="Start date" value={value} onChange={(next) => (value = next)} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Start date'));
  });

  it('moves focus with arrow keys and closes on Escape back to the button', () => {
    render(<DatePickerField id="test-date" label="Start date" value="2026-11-15" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Date Picker' }));
    const day15 = screen.getByRole('button', { name: 'November 15, 2026, selected' });
    day15.focus();
    expect(day15).toHaveFocus();
    fireEvent.keyDown(day15, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'November 16, 2026' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'November 16, 2026' }), { key: 'Escape' });
    expect(screen.queryByText('November 2026')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show Date Picker' })).toHaveFocus();
  });

  it('keeps exactly one day tabbable (roving tabIndex)', () => {
    const { container } = render(
      <DatePickerField id="test-date" label="Start date" value="2026-11-15" onChange={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Date Picker' }));
    const days = Array.from(container.querySelectorAll('[data-date]'));
    expect(days.length).toBeGreaterThan(27);
    expect(days.filter((day) => (day as HTMLElement).tabIndex === 0)).toHaveLength(1);
  });
});
