import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';

function renderReading(content: string) {
  render(
    <MarkdownDocument
      content={content}
      mode="read-only"
      format="markdown"
      links={[]}
      onChange={vi.fn()}
      onNavigate={() => undefined}
    />,
  );
}

describe('markdown task checkboxes in reading view', () => {
  it('renders an unchecked task as a checkbox, not literal bracket text', () => {
    renderReading('- [ ] do this');
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box).not.toBeChecked();
    expect(box.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('[ ]');
    expect(document.body.textContent).toContain('do this');
  });

  it('renders a checked task as a checked checkbox', () => {
    renderReading('- [x] done');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(document.body.textContent).not.toContain('[x]');
  });

  it('accepts an uppercase X marker', () => {
    renderReading('- [X] done');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('leaves plain list items without a checkbox', () => {
    renderReading('- item');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('leaves brackets later in the item text alone', () => {
    renderReading('- see [ ] later');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(document.body.textContent).toContain('see [ ] later');
  });

  it('renders checkboxes for loose lists too', () => {
    renderReading('- [ ] one\n\n- [x] two');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it('renders a checkbox for each nested task item', () => {
    renderReading('- [ ] outer\n  - [ ] inner');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('[ ]');
  });

  it('renders ordered task items as checkboxes', () => {
    renderReading('1. [ ] done');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
