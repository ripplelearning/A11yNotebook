import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RichTextEditor from '../renderer/features/vault/RichTextEditor';
import InsertLinkDialog, { validateRichTextLinkUrl } from '../renderer/features/vault/InsertLinkDialog';

describe('validateRichTextLinkUrl', () => {
  it('accepts http, https, and mailto destinations', () => {
    expect(validateRichTextLinkUrl('https://example.com/guide')).toBe('https://example.com/guide');
    expect(validateRichTextLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(validateRichTextLinkUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
  });

  it('refuses anything that is not a web or email address', () => {
    expect(validateRichTextLinkUrl('javascript:alert(1)')).toBeNull();
    expect(validateRichTextLinkUrl('not a url')).toBeNull();
    expect(validateRichTextLinkUrl('ftp://example.com/file')).toBeNull();
    expect(validateRichTextLinkUrl('')).toBeNull();
  });
});

describe('Insert link in the rich-text editor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  function renderEditor(content = '<p>Visit the guide</p>') {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    const onChange = vi.fn();
    render(<RichTextEditor content={content} notePath="Note.html" onChange={onChange} />);
    return { execCommand, onChange };
  }

  function selectEditorText(start: number, end: number) {
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    const text = editor.querySelector('p')!.firstChild as Node;
    window.getSelection()!.setBaseAndExtent(text, start, text, end);
  }

  function submitLink(address: string, text?: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
    if (text !== undefined) fireEvent.change(screen.getByLabelText('Link text'), { target: { value: text } });
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: address } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  }

  it('inserts the selected text as a link to the typed address', async () => {
    const { execCommand } = renderEditor();
    selectEditorText(6, 15);
    fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link text')).toHaveValue('the guide');
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    // The insert waits until the dialog's focus trap releases.
    await vi.waitFor(() =>
      expect(execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        '<a href="https://example.com/">the guide</a>',
      ),
    );
  });

  it('uses the address itself as the link text when nothing is selected', async () => {
    const { execCommand } = renderEditor('<p>Notes</p>');
    selectEditorText(5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link text')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await vi.waitFor(() =>
      expect(execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        '<a href="https://example.com/">https://example.com/</a>',
      ),
    );
  });

  it('refuses an invalid address instead of inserting a link', () => {
    const { execCommand } = renderEditor();
    selectEditorText(6, 15);
    submitLink('javascript:alert(1)');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(execCommand).not.toHaveBeenCalledWith('insertHTML', false, expect.anything());
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
  });

  it('opens from the a11y:open-link-dialog event', () => {
    renderEditor();
    act(() => {
      window.dispatchEvent(new CustomEvent('a11y:open-link-dialog'));
    });
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
  });
});

describe('InsertLinkDialog', () => {
  it('submits the typed address and text', () => {
    const onSubmit = vi.fn();
    render(<InsertLinkDialog initialText="the guide" onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Link text')).toHaveValue('the guide');
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onSubmit).toHaveBeenCalledWith('https://example.com/', 'the guide');
  });
});
