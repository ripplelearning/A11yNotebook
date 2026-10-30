import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DatePickerField from '../renderer/components/DatePickerField';

describe('DatePickerField', () => {
  it('types a date in text and offers a Show Date Picker button', () => {
    const onChange = vi.fn();
    render(<DatePickerField id="test-date" label="Start date" value="2026-10-30" onChange={onChange} />);
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-30');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-02' } });
    expect(onChange).toHaveBeenCalledWith('2026-11-02');
    expect(screen.getByRole('button', { name: 'Show date picker for Start date' })).toBeInTheDocument();
  });

  it('writes a picked date into the text field and returns focus there', () => {
    let value = '';
    const { rerender } = render(
      <DatePickerField id="test-date" label="Start date" value={value} onChange={(next) => (value = next)} />,
    );
    const picker = screen.getByLabelText('Start date calendar picker') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '2026-11-05' } });
    expect(value).toBe('2026-11-05');
    rerender(<DatePickerField id="test-date" label="Start date" value={value} onChange={(next) => (value = next)} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Start date'));
  });
});
