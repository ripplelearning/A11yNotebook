import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import VaultTree from '../renderer/features/vault/VaultTree';
import type { VaultEntry, VaultLink } from '../shared/types';

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
    render(
      <VaultTree
        entries={entries}
        selectedPath={null}
        onSelect={vi.fn()}
        onOpen={onOpen}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const folder = screen.getByRole('treeitem', { name: /Research/ });
    fireEvent.keyDown(folder, { key: 'ArrowRight' });
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    const note = screen.getByRole('treeitem', { name: /Idea.md/ });
    fireEvent.keyDown(note, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(entries[0].children?.[0]);
  });

  it('renames items through an accessible dialog and restores tree focus', () => {
    const onRename = vi.fn();
    render(
      <VaultTree
        entries={entries}
        selectedPath={null}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    const folder = screen.getByRole('treeitem', { name: /Research/ });
    folder.focus();
    fireEvent.keyDown(folder, { key: 'F2' });

    const dialog = screen.getByRole('dialog', { name: 'Rename item' });
    const name = screen.getByRole('textbox', { name: 'New name' });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Projects' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

    expect(onRename).toHaveBeenCalledWith('Research', 'Projects');
    expect(folder).toHaveFocus();
  });
});

describe('Markdown document', () => {
  it('renders headings semantically and removes raw executable HTML', () => {
    const { container } = render(
      <MarkdownDocument
        content={'# Note\n\n<script>alert(1)</script>\n\n**Safe**'}
        mode="read-only"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Note', level: 1 })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('Safe');
  });

  it('uses a native textarea for Markdown editing', () => {
    render(<MarkdownDocument content="# Note" mode="edit" links={[]} onChange={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Note');
  });

  it('marks unresolved wiki links and routes internal link activation to the host', () => {
    const onNavigate = vi.fn();
    const links: VaultLink[] = [
      { sourcePath: 'Start.md', targetTitle: 'Known', targetPath: 'Known.md', resolved: true, attachment: false },
    ];
    render(
      <MarkdownDocument
        content="[[Known]] and [[Missing]]"
        mode="read-only"
        links={links}
        onChange={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    const known = screen.getByRole('link', { name: 'Known' });
    expect(screen.getByRole('link', { name: 'Missing, missing note' })).toHaveClass('missing-note');
    fireEvent.click(known);
    expect(onNavigate).toHaveBeenCalledWith('#wiki:Known');
  });

  it('routes web links to the host and leaves same-document fragments local', () => {
    const onNavigate = vi.fn();
    render(
      <MarkdownDocument
        content="[Website](https://example.com) [Email](mailto:help@example.com) [Section](#section)"
        mode="read-only"
        links={[]}
        onChange={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Website' }));
    fireEvent.click(screen.getByRole('link', { name: 'Email' }));
    const fragment = screen.getByRole('link', { name: 'Section' });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    fragment.dispatchEvent(clickEvent);

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'https://example.com');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'mailto:help@example.com');
    expect(clickEvent.defaultPrevented).toBe(false);
  });
});
