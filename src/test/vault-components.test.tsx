import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import VaultTree from '../renderer/features/vault/VaultTree';
import ItemDialog, { type ItemDialogRequest } from '../renderer/features/vault/ItemDialog';
import type { VaultEntry, VaultLink } from '../shared/types';

const entries: VaultEntry[] = [
  {
    name: 'Research',
    path: 'Research',
    kind: 'notebook',
    children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note' }],
  },
];

function RenameTree({ onRename }: { onRename: (path: string, name: string) => void }) {
  const [request, setRequest] = useState<ItemDialogRequest | null>(null);
  return (
    <>
      <VaultTree
        entries={entries}
        selectedPath={null}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onRename={(path) => setRequest({ action: 'rename', path, name: path })}
        onDelete={vi.fn()}
      />
      {request ? (
        <ItemDialog
          request={request}
          notebooks={[]}
          onSubmit={async (name) => onRename(request.path!, name)}
          onClose={() => setRequest(null)}
        />
      ) : null}
    </>
  );
}

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

  it('renames an item through a focused dialog and restores focus after submission', async () => {
    const onRename = vi.fn();
    render(<RenameTree onRename={onRename} />);
    const item = screen.getByRole('treeitem', { name: /Research/ });
    item.focus();
    fireEvent.keyDown(item, { key: 'F2' });

    const dialog = screen.getByRole('dialog', { name: 'Rename item' });
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Archive  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename item' }));

    expect(onRename).toHaveBeenCalledWith('Research', 'Archive');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(item).toHaveFocus();
    expect(dialog).not.toBeInTheDocument();
  });

  it('cancels renaming without changing the item and restores focus', () => {
    const onRename = vi.fn();
    render(<RenameTree onRename={onRename} />);
    const item = screen.getByRole('treeitem', { name: /Research/ });
    item.focus();
    fireEvent.keyDown(item, { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(item).toHaveFocus();
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
        onOpenExternal={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Note', level: 1 })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('Safe');
  });

  it('uses a native textarea for Markdown editing', () => {
    render(
      <MarkdownDocument
        content="# Note"
        mode="edit"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Note');
  });

  it('marks unresolved wiki links and routes internal link activation to the host', () => {
    const onNavigate = vi.fn();
    const onOpenExternal = vi.fn();
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
        onOpenExternal={onOpenExternal}
      />,
    );
    const known = screen.getByRole('link', { name: 'Known' });
    expect(screen.getByRole('link', { name: 'Missing, missing note' })).toHaveClass('missing-note');
    fireEvent.click(known);
    expect(onNavigate).toHaveBeenCalledWith('#wiki:Known');
  });

  it('routes external URLs separately and leaves same-document fragments alone', () => {
    const onNavigate = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <MarkdownDocument
        content="[Web](https://example.com) [Email](mailto:help@example.com) [Section](#section)"
        mode="read-only"
        links={[]}
        onChange={vi.fn()}
        onNavigate={onNavigate}
        onOpenExternal={onOpenExternal}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Web' }));
    fireEvent.click(screen.getByRole('link', { name: 'Email' }));
    const fragment = screen.getByRole('link', { name: 'Section' });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    fragment.dispatchEvent(clickEvent);

    expect(onOpenExternal).toHaveBeenNthCalledWith(1, 'https://example.com');
    expect(onOpenExternal).toHaveBeenNthCalledWith(2, 'mailto:help@example.com');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(false);
  });
});
