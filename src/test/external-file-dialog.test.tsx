import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExternalFileDialog from '../renderer/features/vault/ExternalFileDialog';

describe('external file choices', () => {
  it('offers separate explicit import and OS opening without changing anything on cancellation', () => {
    const onOpenWith = vi.fn();
    const onImport = vi.fn();
    const onClose = vi.fn();
    render(
      <ExternalFileDialog name="Outside.md" canImport onOpenWith={onOpenWith} onImport={onImport} onClose={onClose} />,
    );
    expect(screen.getByRole('button', { name: 'Open with…' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenWith).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('disables unsupported imports and reports OS opening errors without closing', async () => {
    const onClose = vi.fn();
    render(
      <ExternalFileDialog
        name="Outside.exe"
        canImport={false}
        onOpenWith={vi.fn().mockRejectedValue(new Error('The system chooser could not be opened.'))}
        onImport={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('button', { name: 'Import into A11y Notebook' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open with…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The system chooser could not be opened.');
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
  });

  it('awaits successful non-destructive import before closing and prevents duplicate submission', async () => {
    let finish!: () => void;
    const onImport = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    render(
      <ExternalFileDialog name="Outside.md" canImport onOpenWith={vi.fn()} onImport={onImport} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import into A11y Notebook' }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
