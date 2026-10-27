import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NoteMetadataDialog from '../renderer/components/NoteMetadataDialog';

afterEach(() => cleanup());

describe('note metadata dialog suggestions', () => {
  it('suggests library field names and values, and preserves scalar types on apply', () => {
    const onApply = vi.fn();
    render(
      <NoteMetadataDialog
        noteTitle="Note"
        content={'---\nstatus: draft\ncount: 5\n---\n# Hello\n'}
        libraryTags={[]}
        libraryFields={{ status: ['done', 'draft'], author: ['Sam'] }}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    // Value suggestions exclude the value already on the note.
    expect(screen.queryByRole('button', { name: 'Use draft' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use done' }));
    expect(screen.getByLabelText('status')).toHaveValue('done');
    // Field suggestions exclude fields already on the note.
    expect(screen.queryByRole('button', { name: 'Use status' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use author' }));
    expect(screen.getByLabelText('New field name')).toHaveValue('author');
    fireEvent.click(screen.getByRole('button', { name: 'Apply metadata' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as string;
    expect(applied).toContain('status: done');
    expect(applied).toContain('count: 5');
    expect(applied).not.toContain('count: "5"');
  });
});
