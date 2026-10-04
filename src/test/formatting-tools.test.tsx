import { createRef, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EditorTools, { type EditorToolsHandle } from '../renderer/features/editor/EditorTools';

afterEach(cleanup);

function Editor({ announce = vi.fn() }: { announce?: (message: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('hello');
  return (
    <>
      <textarea ref={ref} aria-label="Source" value={content} onChange={(event) => setContent(event.target.value)} />
      <EditorTools textareaRef={ref} onContentChange={setContent} announce={announce} notePaths={['Work/Idea.md']} />
      <input aria-label="Other input" />
    </>
  );
}

describe('accessible editor tools', () => {
  it('binds formatting only to the native textarea and leaves normal editing keys alone', () => {
    const announce = vi.fn();
    render(<Editor announce={announce} />);
    const textarea = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 5);
    expect(fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true })).toBe(false);
    expect(textarea).toHaveValue('**hello**');
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('hello');
    expect(announce).toHaveBeenCalledWith('Bold applied.');
    fireEvent.keyDown(textarea, { key: 'i', metaKey: true });
    expect(textarea).toHaveValue('***hello***');
    expect(fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Other input' }), { key: 'b', ctrlKey: true });
    expect(textarea).toHaveValue('***hello***');
  });

  it('has a labelled toolbar with arrow-key and Home/End navigation', () => {
    render(<Editor />);
    const toolbar = screen.getByRole('toolbar', { name: 'Markdown formatting' });
    const bold = within(toolbar).getByRole('button', { name: 'Bold' });
    bold.focus();
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Insert table' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(bold).toHaveFocus();
  });

  it('supports numbered, bullet, and checkbox shortcuts on native textarea selections', () => {
    render(<Editor />);
    const textarea = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);
    fireEvent.keyDown(textarea, { key: '&', code: 'Digit7', ctrlKey: true, shiftKey: true });
    expect(textarea).toHaveValue('1. hello');
    fireEvent.keyDown(textarea, { key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true });
    expect(textarea).toHaveValue('- hello');
    fireEvent.keyDown(textarea, { key: '(', code: 'Digit9', ctrlKey: true, shiftKey: true });
    expect(textarea).toHaveValue('- [ ] hello');
  });

  it('validates URL insertion and restores editor selection after the dialog closes', async () => {
    render(<Editor />);
    const textarea = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 5);
    expect(fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true })).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'l', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.getByRole('alert')).toHaveTextContent('http');
    expect(textarea).toHaveValue('hello');
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(textarea).toHaveValue('[hello](https://example.com/)'));
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });

  it('uses a native note picker and inserts a wiki reference', async () => {
    render(<Editor />);
    const textarea = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Link type' }), { target: { value: 'note' } });
    expect(screen.getByRole('combobox', { name: 'Note' })).toHaveValue('Work/Idea.md');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(textarea).toHaveValue('hello[[Work/Idea]]'));
  });

  it('inserts a bounded table and Escape cancels without changing content', async () => {
    render(<Editor />);
    const textarea = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 5);
    const trigger = screen.getByRole('button', { name: 'Insert table' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Body rows' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(textarea).toHaveValue('hello');
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Body rows' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Columns' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(textarea.value).toBe('hello\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |'));
  });

  it('exposes a host command handle without a global keyboard listener', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const tools = createRef<EditorToolsHandle>();
    render(
      <>
        <textarea ref={ref} defaultValue="note" />
        <EditorTools ref={tools} textareaRef={ref} announce={vi.fn()} notePaths={[]} />
      </>,
    );
    ref.current!.setSelectionRange(0, 4);
    tools.current!.format('heading1');
    expect(ref.current).toHaveValue('# note');
  });

  it('disables local shortcuts and their hints while preserving imperative commands', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const tools = createRef<EditorToolsHandle>();
    render(
      <>
        <textarea ref={ref} defaultValue="note" />
        <EditorTools ref={tools} textareaRef={ref} announce={vi.fn()} notePaths={[]} bindShortcuts={false} />
      </>,
    );
    ref.current!.setSelectionRange(0, 4);
    expect(fireEvent.keyDown(ref.current!, { key: 'b', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(ref.current!, { key: 'l', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(ref.current).toHaveValue('note');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.getByRole('button', { name: 'Insert link' })).not.toHaveAttribute('aria-keyshortcuts');
    tools.current!.format('bold');
    expect(ref.current).toHaveValue('**note**');
  });
});
