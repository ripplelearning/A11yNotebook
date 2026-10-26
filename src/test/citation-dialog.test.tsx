import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CitationDialog from '../renderer/features/vault/CitationDialog';
import type { NotebookBridge } from '../shared/bridge';

function installBridge() {
  const saveBibliography = vi.fn(async (_notebook: string, entries: never[]) => entries);
  const bridge = {
    vault: {
      getBibliography: vi.fn(async () => []),
      saveBibliography,
      fetchCitationMetadata: vi.fn(async () => ({
        sourceType: 'book',
        authors: [{ last: 'Rivera', first: 'Alex' }],
        title: 'Accessible Design',
        year: '2024',
        publisher: 'Open Press',
        doi: '10.1000/xyz123',
      })),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  return { saveBibliography };
}

describe('CitationDialog', () => {
  it('saves a hand-filled entry and inserts its in-text citation', async () => {
    const { saveBibliography } = installBridge();
    const onInsertInText = vi.fn();
    render(
      <CitationDialog
        notebookPath="Research"
        initialView="generator"
        onInsertInText={onInsertInText}
        onInsertBibliography={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Authors/), { target: { value: 'Rivera, Alex' } });
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: 'Accessible Design' } });
    fireEvent.change(screen.getByLabelText(/^Year$/), { target: { value: '2024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to bibliography' }));
    await waitFor(() => expect(saveBibliography).toHaveBeenCalled());
    const saved = saveBibliography.mock.calls[0][1] as Array<{ title: string }>;
    expect(saved[0].title).toBe('Accessible Design');
    fireEvent.click(screen.getByRole('button', { name: 'Insert in-text citation' }));
    expect(onInsertInText).toHaveBeenCalledWith('(Rivera, 2024)');
  });

  it('fills fields from a DOI lookup', async () => {
    installBridge();
    render(
      <CitationDialog
        notebookPath="Research"
        initialView="generator"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/DOI, ISBN, or web address/), {
      target: { value: '10.1000/xyz123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fill in from source' }));
    await waitFor(() => expect(screen.getByText(/Filled from the DOI record/)).toBeInTheDocument());
    expect((screen.getByLabelText(/^Title$/) as HTMLInputElement).value).toBe('Accessible Design');
  });
});
