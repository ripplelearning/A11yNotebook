import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FindDialog from '../renderer/components/FindDialog';

describe('Find dialog', () => {
  it('searches forward and back, honoring match case', () => {
    const onSearch = vi.fn(() => 'Match 1 of 2 for "Idea".');
    render(<FindDialog onClose={vi.fn()} onSearch={onSearch} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in document' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'next', false);
    expect(screen.getByRole('status')).toHaveTextContent('Match 1 of 2 for "Idea".');
    fireEvent.click(screen.getByRole('button', { name: 'Find previous' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'prev', false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Match case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'next', true);
  });

  it('restores the previous search and repopulates the match list on reopen', () => {
    const onListMatches = vi.fn(() => ['Idea at the start', 'Idea again later']);
    const onSearch = vi.fn(() => 'Match 1 of 2 for "Idea".');
    render(
      <FindDialog
        onClose={vi.fn()}
        onSearch={onSearch}
        onListMatches={onListMatches}
        initialQuery="Idea"
        initialCaseSensitive
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Find in document' })).toHaveValue('Idea');
    expect(screen.getByRole('checkbox', { name: 'Match case' })).toBeChecked();
    expect(onListMatches).toHaveBeenCalledWith('Idea', true);
    expect(screen.getByRole('button', { name: 'Match 1: Idea at the start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Match 2: Idea again later' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 matches for "Idea".');
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    expect(onSearch).toHaveBeenCalledWith('Idea', 'next', true);
  });

  it('closes from the Close button', () => {
    const onClose = vi.fn();
    render(<FindDialog onClose={onClose} onSearch={vi.fn(() => 'No matches for "x".')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lists matches with context and jumps to the chosen one on Enter', () => {
    const onClose = vi.fn();
    const onJumpToMatch = vi.fn(() => ({ status: 'Match 2 of 2 for "Idea".', moved: true }));
    render(
      <FindDialog
        onClose={onClose}
        onSearch={vi.fn(() => 'Match 1 of 2 for "Idea".')}
        onListMatches={vi.fn(() => ['Idea at the start', 'Idea again later'])}
        onJumpToMatch={onJumpToMatch}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in document' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    const second = screen.getByRole('button', { name: 'Match 2: Idea again later' });
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: 'Match 1: Idea at the start' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Match 1: Idea at the start' }), {
      key: 'ArrowDown',
    });
    expect(second).toHaveFocus();
    fireEvent.click(second);
    expect(onJumpToMatch).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open when a listed match cannot be moved to', () => {
    const onClose = vi.fn();
    const onJumpToMatch = vi.fn(() => ({
      status: 'This preview cannot be moved to from here.',
      moved: false,
    }));
    render(
      <FindDialog
        onClose={onClose}
        onSearch={vi.fn(() => 'Match 1 of 1 for "Idea".')}
        onListMatches={vi.fn(() => ['Idea in a preview'])}
        onJumpToMatch={onJumpToMatch}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in document' }), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Match 1: Idea in a preview' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('This preview cannot be moved to from here.');
  });
});
