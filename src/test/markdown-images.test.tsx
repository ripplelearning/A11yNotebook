import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { attachmentPathFromUrl } from '../shared/attachments';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import { htmlToMarkdown, markdownImageReference } from '../renderer/features/vault/format-conversion';

/**
 * Markdown notes keep their pictures: a picture pasted or inserted
 * into a Markdown note renders in the reading view with its
 * description, instead of being dropped by the editor round trip.
 * The round trip used to write the internal library URL into the
 * Markdown source and then blank it on render; the reading view now
 * resolves a library URL back to its picture, and the conversion back
 * to Markdown writes a note-relative reference instead.
 */
describe('markdown images', () => {
  it('reads a library-relative path in the reading view', () => {
    const { container } = render(
      <MarkdownDocument
        content={'# Note\n\n![A red dot](Pasted%20image.png)\n'}
        mode="read-only"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'vault-file://attachment/Seeded/Pasted%20image.png',
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', 'A red dot');
  });

  it('reads a library URL in the reading view instead of blanking it', () => {
    const { container } = render(
      <MarkdownDocument
        content={'# Note\n\n![A red dot](vault-file://attachment/Seeded/Pasted%20image.png)\n'}
        mode="read-only"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'vault-file://attachment/Seeded/Pasted%20image.png',
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', 'A red dot');
  });

  it('still blanks external pictures and unsafe library URLs in the reading view', () => {
    const { container } = render(
      <MarkdownDocument
        content={
          '# Note\n\n![Remote](https://example.com/dot.png)\n\n' +
          '![Escape](vault-file://attachment/%2e%2e/secret.png)\n\n' +
          '![Other scheme](vault-file://other/dot.png)\n\n' +
          '![Not an image](vault-file://attachment/Seeded/notes.txt)\n'
        }
        mode="read-only"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    for (const image of Array.from(container.querySelectorAll('img'))) {
      expect(image.getAttribute('src')).toBe('');
    }
  });

  it('keeps a library picture in the rich-text editor', () => {
    render(
      <MarkdownDocument
        content={'# Note\n\n![A red dot](Pasted%20image.png)\n'}
        mode="edit"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    expect(editor.querySelector('img')).toHaveAttribute(
      'src',
      'vault-file://attachment/Seeded/Pasted%20image.png',
    );
    expect(editor.querySelector('img')).toHaveAttribute('alt', 'A red dot');
  });

  it('converts a rich-text library picture back to a note-relative Markdown reference', () => {
    const onChange = vi.fn();
    render(
      <MarkdownDocument
        content={'# Note\n\n![A red dot](Pasted%20image.png)\n'}
        mode="edit"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    fireEvent.input(editor);
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining('![A red dot](Pasted%20image.png)'),
    );
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('vault-file://'));
  });

  it('inserts a pasted picture into Markdown source at the caret, keeping its description', async () => {
    const onChange = vi.fn();
    const onPasteImage = vi
      .fn()
      .mockResolvedValue({ src: 'Pasted image.png', alt: 'A red dot on white' });
    render(
      <MarkdownDocument
        content={'# Note\n\nSome text.\n'}
        mode="edit"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
        onPasteImage={onPasteImage}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Markdown source' }) as HTMLTextAreaElement;
    editor.setSelectionRange(7, 7);
    const file = new File(['pixels'], 'image.png', { type: 'image/png' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [file],
        getData: (type: string) =>
          type === 'text/html' ? '<img src="https://example.com/dot.png" alt="A red dot on white">' : '',
      },
    });
    await waitFor(() => expect(onPasteImage).toHaveBeenCalledWith('Seeded/Note.md', file, 'A red dot on white'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        '# Note\n![A red dot on white](Pasted%20image.png)\nSome text.\n',
      ),
    );
  });

  it('inserts a pasted picture into HTML source at the caret, keeping its description', async () => {
    const onChange = vi.fn();
    const onPasteImage = vi
      .fn()
      .mockResolvedValue({ src: 'Pasted image.png', alt: 'A red dot on white' });
    render(
      <MarkdownDocument
        content={'<h1>Page</h1><p>Some text.</p>'}
        mode="edit"
        format="html"
        notePath="Seeded/Page.html"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
        onPasteImage={onPasteImage}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'HTML source' }) as HTMLTextAreaElement;
    editor.setSelectionRange(13, 13);
    const file = new File(['pixels'], 'image.png', { type: 'image/png' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [file],
        getData: (type: string) =>
          type === 'text/html' ? '<img src="https://example.com/dot.png" alt="A red dot on white">' : '',
      },
    });
    await waitFor(() => expect(onPasteImage).toHaveBeenCalledWith('Seeded/Page.html', file, 'A red dot on white'));
    // The source view is the default edit mode for HTML notes, so this
    // is the path a paste into an open HTML note takes: the inline
    // image lands in the stored HTML with its description, at the
    // library URL the sanitizer writes for a note-relative picture.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining(
          '<img src="vault-file://attachment/Seeded/Pasted%20image.png" alt="A red dot on white">',
        ),
      ),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('<h1>Page</h1>'),
      ),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('<p>Some text.</p>')),
    );
  });

  it('keeps quotes in a pasted picture description in HTML source', async () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn().mockResolvedValue({ src: 'Pasted image.png', alt: 'A "quoted" dot' });
    render(
      <MarkdownDocument
        content={'<h1>Page</h1>'}
        mode="edit"
        format="html"
        notePath="Seeded/Page.html"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
        onPasteImage={onPasteImage}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'HTML source' }) as HTMLTextAreaElement;
    editor.setSelectionRange(13, 13);
    const file = new File(['pixels'], 'image.png', { type: 'image/png' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [file],
        getData: (type: string) =>
          type === 'text/html' ? '<img src="https://example.com/dot.png" alt="A &quot;quoted&quot; dot">' : '',
      },
    });
    await waitFor(() => expect(onPasteImage).toHaveBeenCalledWith('Seeded/Page.html', file, 'A "quoted" dot'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('alt="A &quot;quoted&quot; dot"'),
      ),
    );
  });

  it('leaves a text paste in HTML source to the browser', () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn();
    render(
      <MarkdownDocument
        content={'<h1>Page</h1>'}
        mode="edit"
        format="html"
        notePath="Seeded/Page.html"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
        onPasteImage={onPasteImage}
      />,
    );
    fireEvent.paste(screen.getByRole('textbox', { name: 'HTML source' }), {
      clipboardData: { files: [], getData: () => 'plain text' },
    });
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it('leaves a text paste in Markdown source to the browser', () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn();
    render(
      <MarkdownDocument
        content={'# Note\n'}
        mode="edit"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
        onPasteImage={onPasteImage}
      />,
    );
    fireEvent.paste(screen.getByRole('textbox', { name: 'Markdown source' }), {
      clipboardData: { files: [], getData: () => 'plain text' },
    });
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it('writes a library picture back as a note-relative reference when converting HTML to Markdown', () => {
    expect(
      htmlToMarkdown(
        '<p><img src="vault-file://attachment/Seeded/Pasted%20image.png" alt="A red dot"></p>',
        'Seeded/Note.md',
      ),
    ).toBe('![A red dot](Pasted%20image.png)');
    expect(
      htmlToMarkdown(
        '<p><img src="vault-file://attachment/Seeded/Pasted%20image.png" alt="A red dot"></p>',
        'Seeded/Sub/Note.md',
      ),
    ).toBe('![A red dot](../Pasted%20image.png)');
  });

  it('keeps a library URL untouched when converting HTML to Markdown without a note', () => {
    // A remote picture never reaches the conversion: the sanitizer
    // drops it first, as before.
    expect(htmlToMarkdown('<p><img src="https://example.com/dot.png" alt="Remote"></p>', 'Seeded/Note.md')).toBe(
      '',
    );
    expect(
      htmlToMarkdown('<p><img src="vault-file://attachment/Seeded/Pasted%20image.png" alt="A red dot"></p>'),
    ).toBe('![A red dot](vault-file://attachment/Seeded/Pasted%20image.png)');
  });

  it('inserts a picture into a Markdown note through the toolbar dialog', () => {
    const onChange = vi.fn();
    render(
      <MarkdownDocument
        content={'# Note\n'}
        mode="edit"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    const dialog = screen.getByRole('dialog', { name: 'Insert image' });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Library image path' }), { target: { value: 'Dot.png' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Image description' }), { target: { value: 'A red dot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('![A red dot](Dot.png)'));
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('vault-file://'));
    expect(screen.queryByRole('dialog', { name: 'Insert image' })).not.toBeInTheDocument();
  });

  it('inserts a picture into an HTML note through the toolbar dialog', () => {
    const onChange = vi.fn();
    render(
      <MarkdownDocument
        content={'<h1>Page</h1>'}
        mode="edit"
        format="html"
        notePath="Seeded/Page.html"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Library image path' }), { target: { value: 'Dot.png' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Image description' }), { target: { value: 'A red dot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining('vault-file://attachment/Seeded/Dot.png'),
    );
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('alt="A red dot"'));
  });

  it('requires an image description in the toolbar dialog and cancels without inserting', () => {
    const onChange = vi.fn();
    render(
      <MarkdownDocument
        content={'# Note\n'}
        mode="edit"
        notePath="Seeded/Note.md"
        links={[]}
        onChange={onChange}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Library image path' }), { target: { value: 'Dot.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an image description.');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Insert image' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('builds a parseable Markdown image reference for file names with spaces and parentheses', () => {
    expect(markdownImageReference('A red dot', 'Pasted image.png')).toBe(
      '![A red dot](Pasted%20image.png)',
    );
    expect(markdownImageReference('Chart (Q3)', 'Charts/Chart (Q3).png')).toBe(
      '![Chart (Q3)](Charts/Chart%20%28Q3%29.png)',
    );
    expect(markdownImageReference('A ] bracket', 'dot.png')).toBe('![A \\] bracket](dot.png)');
  });
});

describe('attachmentPathFromUrl', () => {
  it('resolves a safe library URL to its library-relative path', () => {
    expect(attachmentPathFromUrl('vault-file://attachment/Seeded/Pasted%20image.png')).toBe(
      'Seeded/Pasted image.png',
    );
  });

  it('rejects traversal, other schemes, and query strings', () => {
    expect(attachmentPathFromUrl('vault-file://attachment/%2e%2e/secret.png')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://attachment/A%2Fsecret.png')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://attachment/A%5Csecret.png')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://attachment/C%3A/secret.png')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://attachment/%00.png')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://other/test.png')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://attachment/test.png?path=secret')).toBeNull();
    expect(attachmentPathFromUrl('vault-file://attachment/%zz')).toBeNull();
    expect(attachmentPathFromUrl('https://example.com/dot.png')).toBeNull();
  });
});
