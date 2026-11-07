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
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Authors/), { target: { value: 'Rivera, Alex' } });
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: 'Accessible Design' } });
    fireEvent.change(screen.getByLabelText(/^Year$/), { target: { value: '2024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Bibliography' }));
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
        onInsertFootnote={vi.fn()}
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
        onInsertFootnote={vi.fn()}
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
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
        canInsert={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: 'Accessible Design' } });
    expect(screen.getByRole('button', { name: 'Insert In-Text Citation' })).toBeDisabled();
    expect(screen.getByText(/Inserting is disabled/)).toBeInTheDocument();
  });

  it('follows initialView when it changes while the dialog is open', async () => {
    installBridge();
    const { rerender } = render(
      <CitationDialog
        notebookPath="Research"
        initialView="generator"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Citations' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title$/)).toBeInTheDocument();
    rerender(
      <CitationDialog
        notebookPath="Research"
        initialView="bibliography"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole('dialog', { name: 'Bibliography' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title$/)).toBeNull();
    rerender(
      <CitationDialog
        notebookPath="Research"
        initialView="generator"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Citations' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title$/)).toBeInTheDocument();
  });

  it('offers a switch-to-edit action instead of insert controls in reading view', async () => {
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
    const onSwitchToEdit = vi.fn();
    render(
      <CitationDialog
        notebookPath="Research"
        initialView="bibliography"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
        canInsert={false}
        onSwitchToEdit={onSwitchToEdit}
      />,
    );
    expect(await screen.findByText(/Accessible Design/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert In-Text Citation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert full bibliography' })).not.toBeInTheDocument();
    expect(screen.queryByText('Inserting is disabled unless the note is open in edit mode.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to edit mode to insert citations' }));
    expect(onSwitchToEdit).toHaveBeenCalledTimes(1);
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
        onInsertFootnote={vi.fn()}
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

  it('inserts a footnote from an entry in Chicago notes-bibliography mode', async () => {
    const bridge = {
      vault: {
        getBibliography: vi.fn(async () => [
          {
            id: 'book',
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
    const onInsertFootnote = vi.fn();
    render(
      <CitationDialog
        notebookPath="Research"
        initialView="bibliography"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onInsertFootnote={onInsertFootnote}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Accessible Design/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Citation style'), { target: { value: 'chicago-notes' } });
    fireEvent.change(screen.getByLabelText(/Cited page/), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert Footnote' }));
    expect(onInsertFootnote).toHaveBeenCalledWith(expect.objectContaining({ id: 'book' }), '42');
  });

  it('lists both Chicago systems and explains the Markdown limitation', () => {
    render(
      <CitationDialog
        notebookPath="/notes"
        initialView="bibliography"
        onInsertInText={vi.fn()}
        onInsertBibliography={vi.fn()}
        onInsertFootnote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const options = Array.from(screen.getByLabelText('Citation style').querySelectorAll('option')).map((option) =>
      option.textContent?.trim(),
    );
    expect(options).toContain('Chicago (Author-Date)');
    expect(options).toContain('Chicago (Notes-Bibliography)');
    fireEvent.change(screen.getByLabelText('Citation style'), { target: { value: 'apa' } });
    expect(screen.getByText(/cannot be applied, so the inserted list follows the style only as far as plain text allows/i)).toBeInTheDocument();
    expect(screen.queryByText(/uses footnotes: each in-text citation adds a numbered footnote/i)).not.toBeInTheDocument();
  });
});
