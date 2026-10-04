import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExportNoteDialog from '../renderer/features/vault/ExportNoteDialog';

afterEach(cleanup);

describe('note export dialog', () => {
  it('requires explicit consent for protected content and sends the chosen format', async () => {
    const onExport = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(
      <ExportNoteDialog
        path="Notes/Private.html"
        content="<h1>Private</h1>"
        sourceFormat="html"
        protectedNote
        onExport={onExport}
        onClose={onClose}
      />,
    );
    const exportButton = screen.getByRole('button', { name: 'Choose export location…' });
    expect(exportButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /explicitly consent/i }));
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'markdown' } });
    fireEvent.click(exportButton);
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('markdown', true));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('explains local asset and annotation portability and supports cancellation', () => {
    const onClose = vi.fn();
    render(
      <ExportNoteDialog
        path="Notes/Entry.md"
        content="# Entry"
        sourceFormat="markdown"
        protectedNote={false}
        onExport={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/Local raster images are embedded/)).toBeInTheDocument();
    expect(screen.getByText(/Annotation records are stored separately/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
