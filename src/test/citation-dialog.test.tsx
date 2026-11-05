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
    fireEvent.click(screen.getByRole('button', { name: 'Insert In-Text Citation' }));
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

  it('shows a lookup failure without the Electron remote-method wrapper', async () => {
    const bridge = {
      vault: {
        getBibliography: vi.fn(async () => []),
        saveBibliography: vi.fn(async () => []),
        fetchCitationMetadata: vi.fn(async () => {
          throw new Error(
            "Error invoking remote method 'vault:fetch-citation-metadata': Error: That page returned 404.",
          );
        }),
      },
    };
    window.a11yNotebook = bridge as unknown as NotebookBridge;
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
      target: { value: 'https://example.com/missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fill in from source' }));
    await waitFor(() => expect(screen.getByText('That page returned 404.')).toBeInTheDocument());
    expect(screen.queryByText(/Error invoking remote method/)).toBeNull();
  });

  it('disables insert buttons when inserting is not allowed', async () => {
    installBridge();
    render(
      <CitationDialog
        notebookPath="Research"
        initialView="generator"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onClose={vi.fn()}
        canInsert={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: 'Accessible Design' } });
    expect(screen.getByRole('button', { name: 'Insert In-Text Citation' })).toBeDisabled();
    expect(screen.getByText(/Inserting is disabled/)).toBeInTheDocument();
  });

  it('offers Insert In-Text Citation from a bibliography entry context menu', async () => {
    const bridge = {
      vault: {
        getBibliography: vi.fn(async () => [
          {
            id: 'entry-1',
            notebookPath: 'Research',
            sourceType: 'book',
            authors: [{ last: 'Rivera', first: 'Alex' }],
            title: 'Accessible Design',
            year: '2024',
            publisher: 'Open Press',
          },
        ]),
        saveBibliography: vi.fn(async (_notebook: string, entries: never[]) => entries),
      },
    };
    window.a11yNotebook = bridge as unknown as NotebookBridge;
    const onInsertInText = vi.fn();
    render(
      <CitationDialog
        notebookPath="Research"
        initialView="bibliography"
        onInsertInText={onInsertInText}
        onInsertBibliography={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Accessible Design/)).toBeInTheDocument());
    const entryText = screen.getByText(/Accessible Design/);
    const listItem = entryText.closest('li');
    expect(listItem).not.toBeNull();
    fireEvent.contextMenu(listItem!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert In-Text Citation' }));
    expect(onInsertInText).toHaveBeenCalledWith('(Rivera, 2024)');
  });
});
