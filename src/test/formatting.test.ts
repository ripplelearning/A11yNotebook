import { describe, expect, it, vi } from 'vitest';
import {
  applyTextEdit,
  editContent,
  formatText,
  insertionEdit,
  markdownLink,
  markdownTable,
  validateLinkUrl,
  wikiLink,
} from '../renderer/features/editor/formatting';

describe('Markdown formatting transforms', () => {
  it('wraps and unwraps selected text without changing surrounding text', () => {
    const bold = formatText('A word here', 2, 6, 'bold');
    expect(editContent('A word here', bold)).toBe('A **word** here');
    expect([bold.selectionStart, bold.selectionEnd]).toEqual([4, 8]);
    expect(editContent('A **word** here', formatText('A **word** here', 4, 8, 'bold'))).toBe('A word here');
    expect(editContent('**word**', formatText('**word**', 0, 8, 'bold'))).toBe('word');
    expect(editContent('**word**', formatText('**word**', 2, 6, 'italic'))).toBe('***word***');
    expect(editContent('***word***', formatText('***word***', 3, 7, 'italic'))).toBe('**word**');
    expect(editContent('**word**', formatText('**word**', 0, 8, 'italic'))).toBe('***word***');
  });

  it('inserts and selects a placeholder at an empty selection', () => {
    const edit = formatText('Hello ', 6, 6, 'italic');
    expect(editContent('Hello ', edit)).toBe('Hello *text*');
    expect([edit.selectionStart, edit.selectionEnd]).toEqual([7, 11]);
  });

  it('applies block formatting to entire selected lines but not the following line', () => {
    const content = 'first\nsecond\nthird';
    const edit = formatText(content, 2, 13, 'numbered');
    expect(editContent(content, edit)).toBe('1. first\n2. second\nthird');
    expect(editContent('- old\n- next', formatText('- old\n- next', 0, 12, 'checkbox'))).toBe('- [ ] old\n- [ ] next');
    expect(editContent('- [x] done', formatText('- [x] done', 0, 0, 'checkbox'))).toBe('done');
    expect(editContent('# heading', formatText('# heading', 3, 3, 'heading2'))).toBe('## heading');
    expect(editContent('> quote', formatText('> quote', 0, 0, 'quote'))).toBe('quote');
  });

  it('formats empty first and last lines', () => {
    expect(editContent('\nnext', formatText('\nnext', 0, 0, 'bullet'))).toBe('- \nnext');
    expect(editContent('text\n', formatText('text\n', 5, 5, 'heading3'))).toBe('text\n### ');
  });

  it('chooses a safe fence and separates a code block from adjacent text', () => {
    const source = 'before ```code``` after';
    const edit = formatText(source, 7, 17, 'code');
    expect(editContent(source, edit)).toBe('before \n````\n```code```\n````\n after');
    expect(editContent(source, edit).slice(edit.selectionStart, edit.selectionEnd)).toBe('```code```');
  });

  it('creates safe external and wiki links', () => {
    expect(markdownLink('A [label]', 'https://example.com/a(b)')).toBe('[A \\[label\\]](https://example.com/a%28b%29)');
    expect(validateLinkUrl('mailto:person@example.com')).toBe('mailto:person@example.com');
    expect(wikiLink('Work/Idea.md', 'My idea')).toBe('[[Work/Idea|My idea]]');
    expect(wikiLink('Idea.md')).toBe('[[Idea]]');
    expect(() => wikiLink('bad|path.md')).toThrow();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///home/note',
    'https://a b',
    '',
    'mailto:',
    'https://example.com/\nnew',
  ])('rejects unsafe URL %s', (url) => {
    expect(validateLinkUrl(url)).toBeNull();
    expect(() => markdownLink('link', url)).toThrow();
  });

  it('creates a table with bounded dimensions', () => {
    expect(markdownTable(2, 2)).toBe('| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n|  |  |');
    for (const [rows, columns] of [
      [0, 2],
      [51, 2],
      [2, 21],
      [1.5, 2],
      [NaN, 2],
    ]) {
      expect(() => markdownTable(rows, columns)).toThrow();
    }
  });
});

describe('native textarea edit application', () => {
  it('uses native insertText for undo and invokes the explicit callback once', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'old';
    document.body.append(textarea);
    const execCommand = vi.fn((_command, _showUI, text: string) => {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      return true;
    });
    const original = document.execCommand;
    document.execCommand = execCommand;
    const callback = vi.fn();
    try {
      applyTextEdit(textarea, insertionEdit(0, 3, 'new'), callback);
      expect(execCommand).toHaveBeenCalledWith('insertText', false, 'new');
      expect(callback).toHaveBeenCalledExactlyOnceWith('new');
      expect(textarea.selectionStart).toBe(3);
    } finally {
      document.execCommand = original;
      textarea.remove();
    }
  });

  it('falls back to setRangeText with a bubbling input event', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'word';
    document.body.append(textarea);
    const input = vi.fn();
    textarea.addEventListener('input', input);
    const original = document.execCommand;
    document.execCommand = vi.fn(() => false);
    try {
      applyTextEdit(textarea, formatText('word', 0, 4, 'bold'));
      expect(textarea.value).toBe('**word**');
      expect(input).toHaveBeenCalledOnce();
      expect(input.mock.calls[0][0].bubbles).toBe(true);
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('word');
      textarea.readOnly = true;
      applyTextEdit(textarea, insertionEdit(0, 0, 'no'));
      expect(textarea.value).toBe('**word**');
    } finally {
      document.execCommand = original;
      textarea.remove();
    }
  });
});
