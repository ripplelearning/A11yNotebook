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

describe('markdown footnotes in reading view', () => {
  it('renders a footnote marker as a superscript link to its note', () => {
    renderReading('A claim.[^1]\n\n[^1]: Alex Rivera, *Accessible Design* (Open Press, 2024).');
    const marker = screen.getByRole('link', { name: '[1]' });
    expect(marker.getAttribute('href')).toBe('#fn1');
    expect(marker.closest('sup')).not.toBeNull();
    expect(document.body.textContent).not.toContain('[^1]');
  });

  it('renders the notes section with the citation and a backlink to the marker', () => {
    renderReading('A claim.[^1]\n\n[^1]: Alex Rivera, *Accessible Design* (Open Press, 2024).');
    expect(document.body.textContent).toContain('Alex Rivera');
    const backlink = document.querySelector('a.footnote-backref');
    expect(backlink).not.toBeNull();
    expect(backlink?.getAttribute('href')).toBe('#fnref1');
    expect(document.querySelector('section.footnotes')).not.toBeNull();
  });

  it('numbers repeated footnotes in order', () => {
    renderReading('First.[^a] Second.[^b]\n\n[^a]: First note.\n\n[^b]: Second note.');
    expect(screen.getByRole('link', { name: '[1]' }).getAttribute('href')).toBe('#fn1');
    expect(screen.getByRole('link', { name: '[2]' }).getAttribute('href')).toBe('#fn2');
    expect(document.body.textContent).toContain('First note.');
    expect(document.body.textContent).toContain('Second note.');
  });

  it('leaves bracket text that is not a footnote definition alone', () => {
    renderReading('See [^note] for details.');
    expect(document.body.textContent).toContain('[^note]');
    expect(document.querySelector('section.footnotes')).toBeNull();
  });
});
