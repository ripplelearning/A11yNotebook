import { findAllMatches } from './find-text';

export interface DomMatch {
  node: Text;
  start: number;
  length: number;
}

/** All matches of query in the text nodes under root, in document order. */
export function findDomMatches(root: HTMLElement, query: string, caseSensitive: boolean): DomMatch[] {
  const matches: DomMatch[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    for (const match of findAllMatches(node.data, query, caseSensitive)) {
      matches.push({ node, start: match.index, length: match.length });
    }
  }
  return matches;
}

/**
 * Select matches[position] in the document and scroll it into view.
 * Returns false when there is no such match.
 */
export function selectDomMatch(matches: readonly DomMatch[], position: number): boolean {
  const match = matches[position];
  if (!match) return false;
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.start + match.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const element = match.node.parentElement;
  if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center' });
  return true;
}

/**
 * Select an element's text the way Find selects a match: a range anchored
 * on the element's own text nodes (first text node's start to last text
 * node's end), not on the element itself. A whole-element selection
 * (range.selectNodeContents) leaves the selection anchored on the element,
 * with no character position inside any text — a screen reader's virtual
 * cursor does not follow it. A text-node range gives the caret an exact
 * position, which is what moves the virtual cursor. Returns false when
 * the element has no text to select.
 */
export function selectElementText(element: HTMLElement): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.data.length > 0) nodes.push(node);
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return false;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.data.length);
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.rangeCount > 0 && selection.toString().length > 0;
}

/** Where the reader is in a rendered document, for bookmarking from it. */
export interface RenderedHeadingPosition {
  /** The rendered heading at or before the reading position, or null when the position is before the first heading. */
  heading: HTMLElement | null;
  /** True when there is a reading position in the document at all (a selection, or a focused heading). */
  hasPosition: boolean;
}

/**
 * The rendered heading at or before the reader's position in `root`:
 * the selection anchor's containing or preceding heading, or the focused
 * heading when there is no selection in the document. Screen-reader
 * navigation keeps the DOM selection at the virtual cursor, so the
 * selection is the reading position. Returns hasPosition false when
 * neither a selection nor a focused heading is in the document — the
 * note has just opened and reading has not started yet.
 */
export function renderedHeadingAtSelection(root: HTMLElement): RenderedHeadingPosition {
  const headings = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedHeading =
    focused && root.contains(focused) && /^H[1-6]$/.test(focused.tagName) ? focused : null;
  if (!anchor || !root.contains(anchor)) {
    // No selection in the document: a focused heading is the position.
    return { heading: focusedHeading, hasPosition: focusedHeading !== null };
  }
  // The last heading that contains the anchor or precedes it in
  // document order; the first heading after the anchor ends the search.
  // An anchor that is the heading itself (focusing a heading can leave
  // the selection anchored on it) counts as that heading.
  let current: HTMLElement | null = null;
  for (const heading of headings) {
    const position = heading.compareDocumentPosition(anchor);
    if (
      position === 0 ||
      position & Node.DOCUMENT_POSITION_CONTAINED_BY ||
      position & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      current = heading;
    } else {
      break;
    }
  }
  if (current) return { heading: current, hasPosition: true };
  return { heading: focusedHeading, hasPosition: true };
}

/**
 * Select the rendered text of a source line inside a rendered container:
 * the line's first words are located like a Find query and selected, so
 * the virtual cursor lands on that line. Falls back to the container's
 * first text when the line cannot be found (for example, when its words
 * are split across text nodes by inline formatting).
 */
export function selectRenderedLine(container: HTMLElement, lineText: string): boolean {
  const words = lineText.trim().split(/\s+/).filter(Boolean);
  const query = words.slice(0, 3).join(' ');
  if (query) {
    const matches = findDomMatches(container, query, false);
    if (matches.length) return selectDomMatch(matches, 0);
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text | null;
  if (!node || !node.data.trim()) return false;
  return selectElementText(node.parentElement ?? container);
}

/**
 * Focus the search box of an open PDF, ePub, or DOCX reader inside root.
 * The readers label their boxes "Find in PDF", "Find in ePub", and
 * "Find in DOCX". Returns false when no reader search box is present.
 */
export function focusReaderSearchBox(root: HTMLElement): boolean {
  for (const label of Array.from(root.querySelectorAll('label'))) {
    if (/^Find in (PDF|ePub|DOCX)/.test(label.textContent ?? '')) {
      const control = label.control;
      if (control) {
        control.focus();
        return true;
      }
    }
  }
  return false;
}
