import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RichTextEditor from '../renderer/features/vault/RichTextEditor';
import { detectSmartTrigger } from '../renderer/features/vault/smart-formatting';

describe('detectSmartTrigger', () => {
  it('maps heading, list, and checkbox triggers', () => {
    expect(detectSmartTrigger('#')).toEqual({ type: 'heading', level: 1 });
    expect(detectSmartTrigger('###')).toEqual({ type: 'heading', level: 3 });
    expect(detectSmartTrigger('#######')).toBeNull();
    expect(detectSmartTrigger('1.')).toEqual({ type: 'ordered', start: 1 });
    expect(detectSmartTrigger('3.')).toEqual({ type: 'ordered', start: 3 });
    expect(detectSmartTrigger('*')).toEqual({ type: 'unordered' });
    expect(detectSmartTrigger('-')).toEqual({ type: 'unordered' });
    expect(detectSmartTrigger('[]')).toEqual({ type: 'task', checked: false });
    expect(detectSmartTrigger('[x]')).toEqual({ type: 'task', checked: true });
    expect(detectSmartTrigger('[X]')).toEqual({ type: 'task', checked: true });
    expect(detectSmartTrigger('hello #')).toBeNull();
    expect(detectSmartTrigger('')).toBeNull();
  });
});

describe('rich-text smart formatting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it('converts a typed heading trigger instead of inserting the space', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    const onChange = vi.fn();
    render(<RichTextEditor content="<div>#</div>" notePath="Note.md" onChange={onChange} />);
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    const text = editor.firstChild?.firstChild as Node;
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(text, 1, text, 1);
    fireEvent.keyDown(editor, { key: ' ' });
    expect(execCommand).toHaveBeenCalledWith('formatBlock', false, 'h1');
  });

  it('exits an empty list item on Enter instead of adding another item', () => {
    const execCommand = vi.fn();
    document.execCommand = execCommand as typeof document.execCommand;
    const onChange = vi.fn();
    render(<RichTextEditor content="<ul><li></li></ul>" notePath="Note.md" onChange={onChange} />);
    const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
    const item = editor.querySelector('li')!;
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(item, 0, item, 0);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(execCommand).toHaveBeenCalledWith('insertUnorderedList');
  });
});
