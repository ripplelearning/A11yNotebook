import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RichTextEditor from '../renderer/features/vault/RichTextEditor';

describe('citation insertion in the rich text editor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it('inserts an HTML bibliography as formatted HTML, not as visible markup text', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    const onChange = vi.fn();
    render(<RichTextEditor content="<p>Notes</p>" notePath="Note.html" onChange={onChange} />);
    expect(screen.getByRole('textbox', { name: 'Rich text editor' })).toBeInTheDocument();
    const block =
      '<p style="text-align: center; font-weight: bold;">References</p>\n<p style="padding-left: 0.5in; text-indent: -0.5in;">Rivera, A. (2024).</p>';
    window.dispatchEvent(new CustomEvent('a11y:insert-citation-html', { detail: { html: block } }));
    expect(execCommand).toHaveBeenCalledWith('insertHTML', false, block);
    expect(execCommand).not.toHaveBeenCalledWith('insertText', false, expect.anything());
    expect(onChange).toHaveBeenCalled();
  });

  it('ignores an HTML insert with no content', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    render(<RichTextEditor content="<p>Notes</p>" notePath="Note.html" onChange={vi.fn()} />);
    window.dispatchEvent(new CustomEvent('a11y:insert-citation-html', { detail: {} }));
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('still inserts plain citation text as text', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    render(<RichTextEditor content="<p>Notes</p>" notePath="Note.html" onChange={vi.fn()} />);
    window.dispatchEvent(new CustomEvent('a11y:insert-citation-text', { detail: { text: '(Rivera, 2024)' } }));
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '(Rivera, 2024)');
    expect(execCommand).not.toHaveBeenCalledWith('insertHTML', false, expect.anything());
  });
});
