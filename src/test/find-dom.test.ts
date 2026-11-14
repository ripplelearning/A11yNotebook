import { describe, expect, it } from 'vitest';
import {
  findDomMatches,
  focusReaderSearchBox,
  renderedHeadingAtSelection,
  selectDomMatch,
  selectElementText,
  selectRenderedLine,
} from '../shared/find-dom';

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

  it('selects an element as a text-node range, like a Find match', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2>Setup <em>now</em></h2>';
    document.body.appendChild(root);
    const heading = root.querySelector('h2')!;
    expect(selectElementText(heading)).toBe(true);
    const selection = window.getSelection();
    expect(selection?.toString()).toBe('Setup now');
    expect(selection?.isCollapsed).toBe(false);
    // The Find method: the selection is anchored on a text node at a
    // character offset, not on the element — that is what a screen
    // reader's virtual cursor follows. selectNodeContents anchors on
    // the element instead, so the virtual cursor stays put.
    expect(selection?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(selection?.anchorOffset).toBe(0);
    expect(selection?.focusNode?.nodeType).toBe(Node.TEXT_NODE);
    root.remove();
  });

  it('selectElementText returns false when the element has no text', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2></h2>';
    document.body.appendChild(root);
    expect(selectElementText(root.querySelector('h2')!)).toBe(false);
    root.remove();
  });

  it('selects the rendered text of a source line by its first words', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Intro text.</p><p>More text here.</p>';
    document.body.appendChild(root);
    expect(selectRenderedLine(root, 'More text here.')).toBe(true);
    expect(window.getSelection()?.toString()).toBe('More text here.');
    root.remove();
  });

  it('falls back to the first text when a line cannot be found', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Intro text.</p><p>More text.</p>';
    document.body.appendChild(root);
    expect(selectRenderedLine(root, 'a line that is not rendered')).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Intro text.');
    root.remove();
  });

  it('finds the heading at or before the selection', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1>Title</h1><p>Intro text.</p><h2>Setup</h2><p>Details here.</p>';
    document.body.appendChild(root);
    const details = root.querySelectorAll('p')[1]!.firstChild as Text;
    const range = document.createRange();
    range.setStart(details, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const found = renderedHeadingAtSelection(root);
    expect(found.hasPosition).toBe(true);
    expect(found.heading?.textContent).toBe('Setup');
    root.remove();
  });

  it('returns no heading when the selection is before the first heading', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Lead text.</p><h1>Title</h1>';
    document.body.appendChild(root);
    const lead = root.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(lead, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const found = renderedHeadingAtSelection(root);
    expect(found.hasPosition).toBe(true);
    expect(found.heading).toBeNull();
    root.remove();
  });

  it('uses a focused heading when there is no selection in the document', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1>Title</h1><h2>Setup</h2>';
    document.body.appendChild(root);
    window.getSelection()?.removeAllRanges();
    const setup = root.querySelector('h2') as HTMLElement;
    setup.tabIndex = -1;
    setup.focus();
    const found = renderedHeadingAtSelection(root);
    expect(found.hasPosition).toBe(true);
    expect(found.heading).toBe(setup);
    root.remove();
  });

  it('reports no position when neither a selection nor a focused heading is in the document', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1>Title</h1>';
    document.body.appendChild(root);
    window.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const found = renderedHeadingAtSelection(root);
    expect(found.hasPosition).toBe(false);
    expect(found.heading).toBeNull();
    root.remove();
  });
});
