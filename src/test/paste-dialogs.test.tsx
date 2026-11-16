import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PasteLibraryDialog from '../renderer/features/vault/PasteLibraryDialog';
import PasteOrphanDialog from '../renderer/features/vault/PasteOrphanDialog';
import PasteContentDialog from '../renderer/features/vault/PasteContentDialog';
import PasteNotebookDialog from '../renderer/features/vault/PasteNotebookDialog';
import ImportAliusDialog from '../renderer/features/vault/ImportAliusDialog';

describe('paste dialogs', () => {
  it('offers copy versus original for a pasted library', () => {
    const onChoice = vi.fn();
    render(<PasteLibraryDialog folderName="Research" onChoice={onChoice} />);
    fireEvent.click(screen.getByLabelText(/Use the original folder as the library/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onChoice).toHaveBeenCalledWith('original');
  });

  it('offers one notebook or one per file for orphan files', () => {
    const onChoice = vi.fn();
    render(<PasteOrphanDialog files={['a.txt', 'b.txt']} onChoice={onChoice} />);
    expect(screen.getByText('a.txt')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Give each file its own new notebook/));
    fireEvent.click(screen.getByRole('button', { name: 'Organize files' }));
    expect(onChoice).toHaveBeenCalledWith({ mode: 'per-file' });
  });

  it('names the single notebook from the textbox, defaulting to Pasted files', () => {
    const onChoice = vi.fn();
    render(<PasteOrphanDialog files={['a.txt', 'b.txt']} onChoice={onChoice} />);
    const name = screen.getByRole('textbox', { name: 'New notebook name' });
    expect(name).toHaveValue('Pasted files');
    fireEvent.change(name, { target: { value: 'Loose ends' } });
    fireEvent.click(screen.getByRole('button', { name: 'Organize files' }));
    expect(onChoice).toHaveBeenCalledWith({ mode: 'one', notebookName: 'Loose ends' });
  });

  it('hides the name box for one notebook per file and falls back when blank', () => {
    const onChoice = vi.fn();
    render(<PasteOrphanDialog files={['a.txt', 'b.txt']} onChoice={onChoice} />);
    fireEvent.click(screen.getByLabelText(/Give each file its own new notebook/));
    expect(screen.queryByRole('textbox', { name: 'New notebook name' })).toBeNull();
    fireEvent.click(screen.getByLabelText(/Put all of them in one new notebook/));
    fireEvent.change(screen.getByRole('textbox', { name: 'New notebook name' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Organize files' }));
    expect(onChoice).toHaveBeenCalledWith({ mode: 'one', notebookName: 'Pasted files' });
  });

  it('asks note or attachment, format, and name for pasted text, defaulting the name to the first line', () => {
    const onSubmit = vi.fn();
    render(
      <PasteContentDialog
        source={{ kind: 'text', text: 'Shopping list\n- milk\n- bread' }}
        notebookName="Groceries"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Shopping list');
    fireEvent.click(screen.getByLabelText(/File attachment/));
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(onSubmit).toHaveBeenCalledWith({ storeAs: 'attachment', format: 'txt', name: 'Shopping list' });
  });

  it('defaults pasted HTML to a rich-text note', () => {
    const onSubmit = vi.fn();
    render(
      <PasteContentDialog
        source={{ kind: 'html', text: 'Title', html: '<h1>Title</h1>' }}
        notebookName="Research"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Format')).toHaveValue('html');
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(onSubmit).toHaveBeenCalledWith({ storeAs: 'note', format: 'html', name: 'Title' });
  });

  it('stores a pasted picture as an attachment with its description kept', () => {
    const onSubmit = vi.fn();
    render(
      <PasteContentDialog
        source={{ kind: 'image', text: '', imageMimeType: 'image/png', altText: 'A cat' }}
        notebookName="Research"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/New note/)).toBeNull();
    expect(screen.getByRole('textbox', { name: /Alt text/ })).toHaveValue('A cat');
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Pasted image');
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(onSubmit).toHaveBeenCalledWith({
      storeAs: 'attachment',
      format: 'markdown',
      name: 'Pasted image',
      altText: 'A cat',
    });
  });

  it('rejects a file name with separators in the paste dialog', () => {
    const onSubmit = vi.fn();
    render(
      <PasteContentDialog
        source={{ kind: 'text', text: 'Hello' }}
        notebookName="Research"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'Bad/name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(screen.getByRole('alert')).toHaveTextContent('without separators');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers the current notebook first when picking a notebook for a paste', () => {
    const onChoice = vi.fn();
    render(
      <PasteNotebookDialog notebooks={['Alpha', 'Beta', 'Current']} currentNotebook="Current" onChoice={onChoice} />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(['Current', 'Alpha', 'Beta']);
    expect(radios[0]).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Paste here' }));
    expect(onChoice).toHaveBeenCalledWith('Current');
  });

  it('asks for the file name as well as copy or Alius for a pasted file', () => {
    const onChoice = vi.fn();
    render(
      <ImportAliusDialog
        pending={{
          source: '/tmp/Report.docx',
          sourceInLibrary: false,
          notebookPath: 'Work',
          destinationName: 'Report.docx',
          sourceName: 'Report.docx',
          libraryEncrypted: false,
        }}
        askName
        onChoice={onChoice}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Report.docx');
    fireEvent.click(screen.getByLabelText(/Create an Alius/));
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'Annual report.docx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onChoice).toHaveBeenCalledWith('alius', 'Annual report.docx');
  });

  it('does not ask for a file name on a plain import', () => {
    render(
      <ImportAliusDialog
        pending={{
          source: '/tmp/Report.docx',
          sourceInLibrary: false,
          notebookPath: 'Work',
          destinationName: 'Report.docx',
          sourceName: 'Report.docx',
          libraryEncrypted: false,
        }}
        onChoice={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox', { name: 'File name' })).toBeNull();
  });
});
