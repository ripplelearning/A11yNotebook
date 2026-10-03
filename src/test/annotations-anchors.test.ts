import { describe, expect, it } from 'vitest';
import type { NoteAnnotation } from '../shared/annotations';
import {
  captureAnnotationAnchor,
  clearAnnotationMarks,
  documentText,
  renderAnnotationMarks,
  resolveAnnotationAnchor,
} from '../renderer/features/annotations/anchors';

function fixture() {
  const root = document.createElement('div');
  root.innerHTML = '<p>One <strong>bold</strong> and <a href="#note">linked</a> phrase.</p>';
  document.body.append(root);
  return root;
}

function annotation(quote = 'bold and linked', start = 4): NoteAnnotation {
  return {
    id: 'test',
    path: 'Note.md',
    color: 'yellow',
    label: '<img src=x onerror=alert(1)>',
    comment: 'A comment',
    anchor: { quote, prefix: 'One ', suffix: ' phrase.', start, end: start + quote.length },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('annotation anchors', () => {
  it('captures rendered text across emphasis and links with context and offsets', () => {
    const root = fixture();
    const range = document.createRange();
    range.setStart(root.querySelector('strong')!.firstChild!, 0);
    range.setEnd(root.querySelector('a')!.firstChild!, 6);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureAnnotationAnchor(root, selection)).toEqual(annotation().anchor);
    root.remove();
  });

  it('captures element-boundary ranges and rejects selections outside the document', () => {
    const root = fixture();
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('strong')!);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureAnnotationAnchor(root, selection)?.quote).toBe('bold');
    const other = document.createElement('div');
    other.textContent = 'outside';
    document.body.append(other);
    range.selectNodeContents(other);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureAnnotationAnchor(root, selection)).toBeNull();
    other.remove();
    root.remove();
  });

  it('reanchors unique quotes after inserted content and refuses ambiguous or missing text', () => {
    const anchor = annotation().anchor;
    expect(resolveAnnotationAnchor('New intro. One bold and linked phrase.', anchor)).toEqual({ start: 15, end: 30 });
    expect(resolveAnnotationAnchor('Gone', anchor)).toBeNull();
    expect(resolveAnnotationAnchor('One bold and linked phrase. One bold and linked phrase.', anchor)).toBeNull();
    expect(resolveAnnotationAnchor('Other bold and linked ending. One bold and linked phrase.', anchor)?.start).toBe(
      34,
    );
  });

  it('does not use offset alone to choose identical repeated quotes', () => {
    expect(
      resolveAnnotationAnchor('repeat repeat', {
        quote: 'repeat',
        prefix: '',
        suffix: '',
        start: 0,
        end: 6,
      }),
    ).toBeNull();
  });

  it('safely marks split text while preserving semantics, colors, descriptions, and no nested marks', () => {
    const root = fixture();
    const original = documentText(root);
    expect(renderAnnotationMarks(root, [annotation(), { ...annotation('and', 9), id: 'overlap' }])).toEqual(
      new Set(['test']),
    );
    expect(root.querySelectorAll('mark')).toHaveLength(3);
    expect(root.querySelector('mark mark')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('mark')).toHaveAttribute('aria-description', expect.stringContaining('A comment'));
    expect(root.querySelector('mark')?.style.backgroundColor).toBeTruthy();
    expect(root.querySelector('a')?.textContent).toBe('linked');
    expect(documentText(root)).toBe(original);
    renderAnnotationMarks(root, [annotation()]);
    expect(root.querySelectorAll('mark')).toHaveLength(3);
    clearAnnotationMarks(root);
    expect(root.querySelector('mark')).toBeNull();
    expect(documentText(root)).toBe(original);
    root.remove();
  });
});
