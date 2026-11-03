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
      fetchDictionaryDefinitions: vi.fn(async (word: string) =>
        word === 'glad'
          ? [
              {
                partOfSpeech: 'Adjective',
                definitions: [{ definition: 'Feeling pleasure.', example: 'She was glad to help.' }],
              },
            ]
          : [],
      ),
    },
  } as unknown as NotebookBridge;
});

describe('thesaurus dialog', () => {
  it('makes each synonym itself the replace button', async () => {
    const onReplace = vi.fn();
    render(<ThesaurusDialog initialWord="happy" canReplace onReplace={onReplace} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'glad' });
    expect(screen.getByText('Adjective')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'glad' }));
    expect(onReplace).toHaveBeenCalledWith('glad');
  });

  it('looks up the synonym instead of replacing in read mode', async () => {
    const onReplace = vi.fn();
    render(<ThesaurusDialog initialWord="happy" canReplace={false} onReplace={onReplace} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'glad' });
    fireEvent.click(screen.getByRole('button', { name: 'glad' }));
    expect(onReplace).not.toHaveBeenCalled();
    await screen.findByText(/No synonyms found/);
  });

  it('says plainly when no synonyms exist', async () => {
    render(<ThesaurusDialog initialWord="zzzqqq" canReplace onReplace={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/No synonyms found/);
  });

  it('shows definitions from the per-synonym Lookup button', async () => {
    render(<ThesaurusDialog initialWord="happy" canReplace onReplace={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'glad' });
    fireEvent.click(screen.getByRole('button', { name: 'Lookup glad' }));
    await screen.findByText('Definitions for glad');
    expect(screen.getByText('Feeling pleasure.')).toBeTruthy();
    expect(screen.getByText(/She was glad to help/)).toBeTruthy();
  });

  it('reports a failed definition lookup plainly', async () => {
    window.a11yNotebook!.vault.fetchDictionaryDefinitions = vi.fn(async () => {
      throw new Error('No definitions found for “joyful”.');
    });
    render(<ThesaurusDialog initialWord="happy" canReplace onReplace={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'joyful' });
    fireEvent.click(screen.getByRole('button', { name: 'Lookup joyful' }));
    await screen.findByText('No definitions found for “joyful”.');
  });
});
