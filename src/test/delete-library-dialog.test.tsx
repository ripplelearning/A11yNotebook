import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeleteLibraryDialog from '../renderer/features/screens/DeleteLibraryDialog';

describe('Delete library dialog wording', () => {
  it('says Recycle Bin for a plain delete', () => {
    render(
      <DeleteLibraryDialog library={{ name: 'Test', path: '/test' }} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/moved to the Recycle Bin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('says permanent delete, never Recycle Bin, for Shift+Delete', () => {
    render(
      <DeleteLibraryDialog
        library={{ name: 'Test', path: '/test' }}
        permanent
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/cannot be undone and does not go to the Recycle Bin/)).toBeInTheDocument();
    expect(screen.queryByText(/moved to the Recycle Bin/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument();
  });
});
