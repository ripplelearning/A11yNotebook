import { describe, expect, it } from 'vitest';
import {
  findDomMatches,
  focusReaderSearchBox,
  renderedHeadingAtSelection,
  selectDomMatch,
  selectElementText,
  selectRenderedLineAt,
  selectionRenderedSegments,
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
    expect(selectRenderedLineAt(root, 'More text here.', [0, 0, 0])).toBe(true);
    expect(window.getSelection()?.toString()).toBe('More text here.');
    root.remove();
  });

  it('returns false when a line cannot be found instead of falling back to the top', () => {
    // The old fallback selected the container's first text — the top of
    // the note — while the jump announced success. A missing line is a
    // miss: the caller falls back to the containing heading instead.
    const root = document.createElement('div');
    root.innerHTML = '<p>Intro text.</p><p>More text.</p>';
    document.body.appendChild(root);
    expect(selectRenderedLineAt(root, 'a line that is not rendered', [0, 0, 0])).toBe(false);
    expect(window.getSelection()?.toString()).toBe('');
    root.remove();
  });

  it('selects the second occurrence of a repeated line, not the first', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Details here.</p><p>Details here.</p>';
    document.body.appendChild(root);
    expect(selectRenderedLineAt(root, 'Details here.', [1, 1, 1])).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Details here.');
    const second = root.querySelectorAll('p')[1]!;
    expect(second.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
    root.remove();
  });

  it('ignores the same words in the middle of another line', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>See Details here for more.</p><p>Details here.</p>';
    document.body.appendChild(root);
    expect(selectRenderedLineAt(root, 'Details here.', [0, 0, 0])).toBe(true);
    const second = root.querySelectorAll('p')[1]!;
    expect(second.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
    root.remove();
  });

  it('shortens the query when formatting splits the first words across text nodes', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p><strong>More</strong> text here.</p>';
    document.body.appendChild(root);
    // "More text here." spans two text nodes, so the three-word query
    // never matches one node; the one-word query does.
    expect(selectRenderedLineAt(root, 'More text here.', [0, 0, 0])).toBe(true);
    expect(window.getSelection()?.toString()).toBe('More');
    root.remove();
  });

  it('finds a line after a soft break inside its paragraph', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>First line\nSecond line</p>';
    document.body.appendChild(root);
    expect(selectRenderedLineAt(root, 'Second line', [0, 0, 0])).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Second line');
    root.remove();
  });

  it('finds a line after a hard break inside its paragraph', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>First line<br>Second line</p>';
    document.body.appendChild(root);
    expect(selectRenderedLineAt(root, 'Second line', [0, 0, 0])).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Second line');
    root.remove();
  });

  it('reports the rendered lines and the selection’s line', () => {
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
    expect(selectionRenderedSegments(root)).toEqual({
      segments: ['Title', 'Intro text.', 'Setup', 'Details here.'],
      selectedIndex: 3,
    });
    root.remove();
  });

  it('splits a soft-broken paragraph into its lines for the selection', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>First line\nSecond line</p>';
    document.body.appendChild(root);
    const node = root.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, node.data.indexOf('Second') + 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selectionRenderedSegments(root)).toEqual({
      segments: ['First line', 'Second line'],
      selectedIndex: 1,
    });
    root.remove();
  });

  it('returns null when there is no selection in the document', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Intro text.</p>';
    document.body.appendChild(root);
    window.getSelection()?.removeAllRanges();
    expect(selectionRenderedSegments(root)).toBeNull();
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
