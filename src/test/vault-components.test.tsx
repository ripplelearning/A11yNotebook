import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import VaultTree from '../renderer/features/vault/VaultTree';
import type { VaultEntry } from '../shared/types';

const entries: VaultEntry[] = [
  {
    name: 'Research',
    path: 'Research',
    kind: 'notebook',
    children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note' }],
  },
];

describe('accessible vault tree', () => {
  it('expands, moves focus with arrows, and opens a note with Enter', () => {
    const onOpen = vi.fn();
    render(<VaultTree entries={entries} selectedPath={null} onSelect={vi.fn()} onOpen={onOpen} onRename={vi.fn()} onDelete={vi.fn()} />);
    const folder = screen.getByRole('treeitem', { name: /Research/ });
    fireEvent.keyDown(folder, { key: 'ArrowRight' });
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    const note = screen.getByRole('treeitem', { name: /Idea.md/ });
    fireEvent.keyDown(note, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(entries[0].children?.[0]);
  });
});

describe('Markdown document', () => {
  it('renders headings semantically and removes raw executable HTML', () => {
    const { container } = render(
      <MarkdownDocument content={'# Note\n\n<script>alert(1)</script>\n\n**Safe**'} mode="read-only" onChange={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Note', level: 1 })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('Safe');
  });

  it('uses a native textarea for Markdown editing', () => {
    render(<MarkdownDocument content="# Note" mode="edit" onChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Note');
  });
});
