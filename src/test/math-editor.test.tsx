import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RichTextEditor from '../renderer/features/vault/RichTextEditor';

describe('mathematics toolbar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it('opens from the toolbar, previews MathML, and inserts it at the caret', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    render(<RichTextEditor content="<p>Result: </p>" notePath="Note.html" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mathematics' }));
    const input = screen.getByLabelText('ASCII math');
    fireEvent.change(input, { target: { value: 'sqrt(16)' } });
    expect(screen.getByLabelText('Math preview').innerHTML).toContain('<msqrt>');
    fireEvent.click(screen.getByRole('button', { name: 'Insert math' }));
    expect(execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      expect.stringContaining('<math alttext="sqrt(16)">'),
    );
  });

  it('refuses unparseable math instead of inserting it', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    render(<RichTextEditor content="<p></p>" notePath="Note.html" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mathematics' }));
    fireEvent.change(screen.getByLabelText('ASCII math'), { target: { value: 'sqrt(' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert math' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(execCommand).not.toHaveBeenCalledWith('insertHTML', false, expect.anything());
  });

  it('auto-converts typed ASCII math at the caret', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    render(<RichTextEditor content="<p>sqrt(16)</p>" notePath="Note.html" onChange={vi.fn()} />);
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    const text = editor.querySelector('p')!.firstChild as Node;
    window.getSelection()!.setBaseAndExtent(text, 8, text, 8);
    fireEvent.input(editor);
    expect(execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      expect.stringContaining('<math alttext="sqrt(16)">'),
    );
  });

  it('does not auto-convert ordinary words', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    render(<RichTextEditor content="<p>catalog</p>" notePath="Note.html" onChange={vi.fn()} />);
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    const text = editor.querySelector('p')!.firstChild as Node;
    window.getSelection()!.setBaseAndExtent(text, 7, text, 7);
    fireEvent.input(editor);
    expect(execCommand).not.toHaveBeenCalledWith('insertHTML', false, expect.anything());
  });
});
