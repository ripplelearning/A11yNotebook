import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PasteLibraryDialog from '../renderer/features/vault/PasteLibraryDialog';
import PasteOrphanDialog from '../renderer/features/vault/PasteOrphanDialog';

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
    expect(onChoice).toHaveBeenCalledWith('per-file');
  });
});
