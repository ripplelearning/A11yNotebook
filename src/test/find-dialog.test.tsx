import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FindDialog from '../renderer/components/FindDialog';

describe('Find dialog', () => {
  it('searches forward and back, honoring match case', () => {
    const onSearch = vi.fn(() => 'Match 1 of 2 for "Idea".');
    render(<FindDialog onClose={vi.fn()} onSearch={onSearch} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in note' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'next', false);
    expect(screen.getByRole('status')).toHaveTextContent('Match 1 of 2 for "Idea".');
    fireEvent.click(screen.getByRole('button', { name: 'Find previous' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'prev', false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Match case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'next', true);
  });

  it('closes from the Close button', () => {
    const onClose = vi.fn();
    render(<FindDialog onClose={onClose} onSearch={vi.fn(() => 'No matches for "x".')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
