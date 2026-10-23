import { describe, expect, it } from 'vitest';
import type { NoteAnnotation } from '../shared/annotations';
import {
  captureAnnotationAnchor,
  documentText,
  renderAnnotationMarks,
  resolveAnnotationAnchor,
} from '../renderer/features/annotations/anchors';

// Markdown/HTML annotation parity: anchors are captured against the
// rendered document's text, so the same visible content must behave the
// same whether it came from Markdown rendering or authored HTML — an
// annotation must survive a Markdown→HTML format conversion of its note.

const MARKDOWN_RENDERED =
  '<h2>Supplies</h2><p>Remember to <strong>pack the tent</strong> and <a href="#note">check the list</a> before Friday.</p>';
const AUTHORED_HTML =
  '<h2>Supplies</h2><p>Remember to <em>pack the tent</em> and <a href="https://example.com">check the list</a> before Friday.</p>';

function fixture(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function captureOn(root: HTMLElement): NoteAnnotation['anchor'] {
  const range = document.createRange();
  const strong = root.querySelector('strong, em')!;
  range.setStart(strong.firstChild!, 0);
  range.setEnd(strong.firstChild!, 4);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const anchor = captureAnnotationAnchor(root, selection);
  if (!anchor) throw new Error('Expected an anchor.');
  return anchor;
}

describe('Markdown/HTML annotation parity', () => {
  it('captures the same anchor for the same visible text in both renderings', () => {
    const fromMarkdown = fixture(MARKDOWN_RENDERED);
    const fromHtml = fixture(AUTHORED_HTML);
    expect(documentText(fromMarkdown)).toBe(documentText(fromHtml));
    expect(captureOn(fromMarkdown)).toEqual(captureOn(fromHtml));
    fromMarkdown.remove();
    fromHtml.remove();
  });

  it('resolves and marks an anchor captured in one format inside the other format', () => {
    const source = fixture(MARKDOWN_RENDERED);
    const anchor = captureOn(source);
    const target = fixture(AUTHORED_HTML);
    const resolved = resolveAnnotationAnchor(documentText(target), anchor);
    expect(resolved).not.toBeNull();
    expect(documentText(target).slice(resolved!.start, resolved!.end)).toBe(anchor.quote);
    const annotation: NoteAnnotation = {
      id: 'parity-1',
      path: 'Note.html',
      anchor,
      color: 'green',
      label: 'Parity',
      comment: '',
      createdAt: '2026-10-23T00:00:00.000Z',
      updatedAt: '2026-10-23T00:00:00.000Z',
    };
    const rendered = renderAnnotationMarks(target, [annotation]);
    expect(rendered.has('parity-1')).toBe(true);
    expect(target.querySelector('mark')?.textContent).toBe(anchor.quote);
    source.remove();
    target.remove();
  });
});
