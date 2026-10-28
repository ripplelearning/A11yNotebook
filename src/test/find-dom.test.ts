import { describe, expect, it } from 'vitest';
import { findDomMatches, focusReaderSearchBox, selectDomMatch } from '../shared/find-dom';

describe('find-dom', () => {
  it('finds matches across text nodes in document order', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Alpha beta</p><p>alpha again</p>';
    const matches = findDomMatches(root, 'alpha', false);
    expect(matches).toHaveLength(2);
    expect(matches[0]?.start).toBe(0);
    expect(matches[1]?.start).toBe(0);
  });

  it('respects match case', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Alpha alpha</p>';
    expect(findDomMatches(root, 'alpha', true)).toHaveLength(1);
    expect(findDomMatches(root, 'alpha', false)).toHaveLength(2);
  });

  it('selects the match at the given position', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Alpha beta Alpha</p>';
    document.body.appendChild(root);
    const matches = findDomMatches(root, 'Alpha', false);
    expect(selectDomMatch(matches, 1)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Alpha');
    expect(selectDomMatch(matches, 2)).toBe(false);
    root.remove();
  });

  it('focuses a reader search box by its label', () => {
    const root = document.createElement('div');
    root.innerHTML = '<label>Find in PDF<input /></label>';
    document.body.appendChild(root);
    expect(focusReaderSearchBox(root)).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('input'));
    root.remove();
  });

  it('reports no reader search box when none is present', () => {
    const root = document.createElement('div');
    root.innerHTML = '<label>Search<input /></label>';
    expect(focusReaderSearchBox(root)).toBe(false);
  });
});
