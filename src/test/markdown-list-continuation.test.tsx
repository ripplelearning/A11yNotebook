import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import { continueMarkdownList } from '../renderer/features/vault/smart-formatting';
import { createStatusAnnouncer, type StatusAnnouncer } from '../renderer/status-announcer';

describe('markdown list continuation', () => {
  it('continues an unordered item on Enter', () => {
    expect(continueMarkdownList('- item', 6, 6)).toEqual({ value: '- item\n- ', caret: 9, announcement: 'bullet' });
  });

  it('increments an ordered item and keeps its delimiter', () => {
    expect(continueMarkdownList('2. item', 7, 7)).toEqual({ value: '2. item\n3. ', caret: 11, announcement: '3.' });
    expect(continueMarkdownList('1) item', 7, 7)).toEqual({ value: '1) item\n2) ', caret: 11, announcement: '2)' });
  });

  it('continues a checked task item as a fresh unchecked item', () => {
    expect(continueMarkdownList('- [x] done', 10, 10)).toEqual({ value: '- [x] done\n- [ ] ', caret: 17, announcement: 'task' });
    expect(continueMarkdownList('1. [ ] done', 11, 11)).toEqual({ value: '1. [ ] done\n2. [ ] ', caret: 19, announcement: 'task' });
  });

  it('keeps the indent of a nested item', () => {
    expect(continueMarkdownList('  - item', 8, 8)).toEqual({ value: '  - item\n  - ', caret: 13, announcement: 'bullet' });
  });

  it('splits the item when Enter is pressed mid-line', () => {
    expect(continueMarkdownList('- fooo', 4, 4)).toEqual({ value: '- fo\n- oo', caret: 7, announcement: 'bullet' });
  });

  it('ends the list on Enter in an empty item, so a second Enter stops the list', () => {
    const first = continueMarkdownList('- item', 6, 6)!;
    expect(first.value).toBe('- item\n- ');
    const second = continueMarkdownList(first.value, first.caret, first.caret)!;
    expect(second).toEqual({ value: '- item\n', caret: 7, announcement: 'List ended.' });
  });

  it('ends an empty ordered item too', () => {
    expect(continueMarkdownList('3. ', 3, 3)).toEqual({ value: '', caret: 0, announcement: 'List ended.' });
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

  it('announces the auto-inserted marker instead of applying it silently', () => {
    const onChange = vi.fn();
    const announce = vi.fn();
    render(
      <MarkdownDocument
        content="2. item"
        mode="edit"
        format="markdown"
        links={[]}
        onChange={onChange}
        onNavigate={() => undefined}
        announce={announce}
      />,
    );
    const area = screen.getByLabelText('Markdown source') as HTMLTextAreaElement;
    area.setSelectionRange(7, 7);
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(announce).toHaveBeenCalledWith('3.');
  });
});

describe('repeated task announcements', () => {
  it('announces "task" after every Enter in a task list, not just the first', async () => {
    // A polite live region only speaks when its text changes, so the
    // second Enter must clear "task" and set it again for the screen
    // reader to hear it a second time.
    function Harness() {
      const [content, setContent] = useState('- [ ] first task');
      const [message, setMessage] = useState('Ready');
      const announceRef = useRef<StatusAnnouncer | null>(null);
      if (announceRef.current === null) {
        announceRef.current = createStatusAnnouncer(setMessage);
      }
      return (
        <>
          <span role="status" aria-live="polite">
            {message}
          </span>
          <MarkdownDocument
            content={content}
            mode="edit"
            format="markdown"
            links={[]}
            onChange={setContent}
            onNavigate={() => undefined}
            announce={announceRef.current}
          />
        </>
      );
    }

    vi.useFakeTimers();
    try {
      render(<Harness />);
      const area = screen.getByLabelText('Markdown source') as HTMLTextAreaElement;
      const status = screen.getByRole('status');

      area.setSelectionRange(16, 16);
      fireEvent.keyDown(area, { key: 'Enter' });
      // The region is cleared synchronously; the announcement lands after
      // the delay. Without the clear, the second Enter below would set the
      // identical text and the screen reader would stay silent.
      expect(status.textContent).toBe('');
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(status.textContent).toBe('task');

      // Type the second task on the auto-created line, then press Enter again.
      fireEvent.change(area, { target: { value: '- [ ] first task\n- [ ] second task' } });
      area.setSelectionRange(34, 34);
      fireEvent.keyDown(area, { key: 'Enter' });
      // The region must clear again, or the identical "task" never re-announces.
      expect(status.textContent).toBe('');
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(status.textContent).toBe('task');
    } finally {
      vi.useRealTimers();
    }
  });
});
