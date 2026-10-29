import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import { continueMarkdownList } from '../renderer/features/vault/smart-formatting';

describe('markdown list continuation', () => {
  it('continues an unordered item on Enter', () => {
    expect(continueMarkdownList('- item', 6, 6)).toEqual({ value: '- item\n- ', caret: 9 });
  });

  it('increments an ordered item and keeps its delimiter', () => {
    expect(continueMarkdownList('2. item', 7, 7)).toEqual({ value: '2. item\n3. ', caret: 11 });
    expect(continueMarkdownList('1) item', 7, 7)).toEqual({ value: '1) item\n2) ', caret: 11 });
  });

  it('continues a checked task item as a fresh unchecked item', () => {
    expect(continueMarkdownList('- [x] done', 10, 10)).toEqual({ value: '- [x] done\n- [ ] ', caret: 17 });
    expect(continueMarkdownList('1. [ ] done', 11, 11)).toEqual({ value: '1. [ ] done\n2. [ ] ', caret: 19 });
  });

  it('keeps the indent of a nested item', () => {
    expect(continueMarkdownList('  - item', 8, 8)).toEqual({ value: '  - item\n  - ', caret: 13 });
  });

  it('splits the item when Enter is pressed mid-line', () => {
    expect(continueMarkdownList('- fooo', 4, 4)).toEqual({ value: '- fo\n- oo', caret: 7 });
  });

  it('ends the list on Enter in an empty item, so a second Enter stops the list', () => {
    const first = continueMarkdownList('- item', 6, 6)!;
    expect(first.value).toBe('- item\n- ');
    const second = continueMarkdownList(first.value, first.caret, first.caret)!;
    expect(second).toEqual({ value: '- item\n', caret: 7 });
  });

  it('ends an empty ordered item too', () => {
    expect(continueMarkdownList('3. ', 3, 3)).toEqual({ value: '', caret: 0 });
  });

  it('leaves non-list lines and selections alone', () => {
    expect(continueMarkdownList('plain text', 10, 10)).toBeNull();
    expect(continueMarkdownList('- item', 0, 6)).toBeNull();
    expect(continueMarkdownList('# Heading', 9, 9)).toBeNull();
  });
});

describe('markdown source textarea', () => {
  it('continues the list on Enter and ends it on a second Enter', () => {
    const onChange = vi.fn();
    render(
      <MarkdownDocument
        content="- item"
        mode="edit"
        format="markdown"
        links={[]}
        onChange={onChange}
        onNavigate={() => undefined}
      />,
    );
    const area = screen.getByLabelText('Markdown source') as HTMLTextAreaElement;
    area.setSelectionRange(6, 6);
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('- item\n- ');
  });
});
