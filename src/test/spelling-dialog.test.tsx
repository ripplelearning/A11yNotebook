import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SpellingDialog from '../renderer/features/vault/SpellingDialog';

afterEach(cleanup);

describe('spelling and grammar dialog', () => {
  it('changes a misspelling and applies it on close', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <SpellingDialog
        notePath="note.md"
        content="Teh cat sat."
        customWords={[]}
        onApply={onApply}
        onAddToDictionary={vi.fn()}
        onClose={onClose}
      />,
    );
    await screen.findByText('Teh', {}, { timeout: 8000 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await screen.findByText(/Check complete/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onApply).toHaveBeenCalledWith('The cat sat.');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('explains and fixes a grammar issue', async () => {
    const onApply = vi.fn();
    render(
      <SpellingDialog
        notePath="note.md"
        content="I have alot of time."
        customWords={[]}
        onApply={onApply}
        onAddToDictionary={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('alot', {}, { timeout: 8000 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await screen.findByText(/Check complete/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onApply).toHaveBeenCalledWith('I have a lot of time.');
  });

  it('adds a word to the dictionary and stops flagging it', async () => {
    const onAdd = vi.fn();
    render(
      <SpellingDialog
        notePath="note.md"
        content="Teh cat sat. Teh dog ran."
        customWords={[]}
        onApply={vi.fn()}
        onAddToDictionary={onAdd}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('Teh', {}, { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Dictionary' }));
    expect(onAdd).toHaveBeenCalledWith('teh');
    await screen.findByText(/Check complete/);
  });
});
