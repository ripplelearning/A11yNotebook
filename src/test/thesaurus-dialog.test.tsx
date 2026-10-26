import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThesaurusDialog from '../renderer/features/vault/ThesaurusDialog';
import type { NotebookBridge } from '../shared/bridge';

afterEach(cleanup);

beforeEach(() => {
  window.a11yNotebook = {
    vault: {
      lookupThesaurus: vi.fn(async (word: string) =>
        word === 'happy' ? [{ partOfSpeech: 'Adjective', synonyms: ['glad', 'joyful'] }] : [],
      ),
    },
  } as unknown as NotebookBridge;
});

describe('thesaurus dialog', () => {
  it('shows synonyms and replaces the selected word', async () => {
    const onReplace = vi.fn();
    render(<ThesaurusDialog initialWord="happy" canReplace onReplace={onReplace} onClose={vi.fn()} />);
    await screen.findByText('glad');
    expect(screen.getByText('Adjective')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Replace with this word' })[0]);
    expect(onReplace).toHaveBeenCalledWith('glad');
  });

  it('offers no replace button in read mode', async () => {
    render(<ThesaurusDialog initialWord="happy" canReplace={false} onReplace={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('glad');
    expect(screen.queryByRole('button', { name: 'Replace with this word' })).toBeNull();
  });

  it('says plainly when no synonyms exist', async () => {
    render(<ThesaurusDialog initialWord="zzzqqq" canReplace onReplace={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/No synonyms found/);
  });
});
