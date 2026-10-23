import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AttachmentView from '../renderer/features/previews/AttachmentView';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import PlainTextDocument from '../renderer/features/vault/PlainTextDocument';

describe('structured plain-text reading view', () => {
  it('renders blank-line blocks as paragraphs and keeps single line breaks', () => {
    const { container } = render(<PlainTextDocument text={'First line\nsecond line\n\nNew paragraph'} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].querySelector('br')).not.toBeNull();
    expect(paragraphs[0].textContent).toBe('First linesecond line');
    expect(paragraphs[1].textContent).toBe('New paragraph');
  });

  it('reads .txt notes literally instead of parsing Markdown', () => {
    const { container } = render(
      <MarkdownDocument
        content={'# Not a heading\n\nSome *literal* text'}
        mode="read-only"
        format="text"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
        notePath="Notebook/Note.txt"
      />,
    );
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.textContent).toContain('# Not a heading');
    expect(container.textContent).toContain('Some *literal* text');
  });

  it('edits .txt notes in a plain textarea without a rich-text mode', () => {
    render(
      <MarkdownDocument
        content="Plain content"
        mode="edit"
        format="text"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
        notePath="Notebook/Note.txt"
      />,
    );
    expect(screen.getByLabelText('Plain text source')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rich text' })).toBeNull();
  });

  it('previews text attachments as paragraphs, not a pre block', () => {
    const { container } = render(
      <AttachmentView
        preview={{ path: 'Notebook/Readme.txt', kind: '.txt', text: 'Alpha\n\nBeta' }}
        alt=""
        onSaveAlt={vi.fn(async () => {})}
        onExternal={vi.fn()}
        announce={vi.fn()}
      />,
    );
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});
