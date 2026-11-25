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

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, dt, dd, figcaption';

function closestBlock(node: Node, container: HTMLElement): HTMLElement {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(BLOCK_SELECTOR) ?? container;
}

/**
 * Whether a match starts a rendered line: the text before it inside its
 * block is blank, ends at a soft line break, or follows a hard break.
 * A match in the middle of a line is not a line start, even when its
 * words are the line's first words — another line further down may
 * repeat them. A `<br>` counts as a line break, the way plain-text
 * notes render single line breaks; a soft break is the newline inside
 * the text node itself.
 */
function isLineStartMatch(container: HTMLElement, node: Text, start: number): boolean {
  const block = closestBlock(node, container);
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(candidate) {
      if (candidate.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (candidate instanceof HTMLBRElement) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  let before = '';
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === node) {
      before += node.data.slice(0, start);
      break;
    }
    before += current.nodeType === Node.TEXT_NODE ? (current as Text).data : '\n';
  }
  return before.trim() === '' || before.endsWith('\n');
}

/**
 * Select the rendered line `lineText` at `occurrences[wordCount - 1]`,
 * the way Find selects a match: a range anchored on the line's own
 * text nodes at an exact character offset. The query is the line's
 * first words — up to three, shortening to two, then one, when inline
 * formatting splits the words across text nodes — and the occurrence
 * counts lines that start the same way, so a jump lands on the
 * bookmarked line and never on an earlier look-alike. A line-start
 * match only: the same words in the middle of another line do not
 * count. Returns false when the line cannot be found, instead of
 * falling back to the top of the document — the caller falls back to
 * the containing heading.
 */
export function selectRenderedLineAt(
  container: HTMLElement,
  lineText: string,
  occurrences: readonly number[],
): boolean {
  const words = lineText.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  for (let wordCount = Math.min(3, words.length); wordCount >= 1; wordCount -= 1) {
    const query = words.slice(0, wordCount).join(' ');
    const matches = findDomMatches(container, query, false).filter((match) =>
      isLineStartMatch(container, match.node, match.start),
    );
    const occurrence = occurrences[wordCount - 1] ?? 0;
    if (matches[occurrence]) return selectDomMatch(matches, occurrence);
  }
  return false;
}

export interface RenderedSegments {
  /** The rendered lines of the document in order: each block's text split at line breaks, blank pieces dropped. */
  segments: string[];
  /** The segment the selection sits in, or -1 when the selection is not in the document. */
  selectedIndex: number;
}

function blockTexts(root: HTMLElement): { element: HTMLElement; nodes: Text[]; text: string }[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blocks: { element: HTMLElement; nodes: Text[]; text: string }[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const block = closestBlock(node, root);
    const last = blocks[blocks.length - 1];
    if (last && last.element === block) {
      last.nodes.push(node);
      last.text += node.data;
    } else {
      blocks.push({ element: block, nodes: [node], text: node.data });
    }
  }
  return blocks;
}

/**
 * The rendered lines of `root` in document order, and which one the
 * selection sits in — the reader's exact line, for bookmarking a
 * position from the reading view. The selection anchor is the reading
 * position, as renderedHeadingAtSelection reads it. Returns null when
 * there is no selection in the document, or when the selection cannot
 * be placed inside a text node: the caller falls back to the heading
 * the reader is under.
 */
export function selectionRenderedSegments(root: HTMLElement): RenderedSegments | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  let anchorNode: Text | null = null;
  let anchorOffset = 0;
  if (selection.anchorNode?.nodeType === Node.TEXT_NODE) {
    anchorNode = selection.anchorNode as Text;
    anchorOffset = selection.anchorOffset;
  } else if (selection.anchorNode instanceof Element) {
    const child = selection.anchorNode.childNodes[selection.anchorOffset];
    const scope = child ?? selection.anchorNode;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    anchorNode = walker.nextNode() as Text | null;
    anchorOffset = 0;
  }
  if (!anchorNode || !root.contains(anchorNode)) return null;
  const segments: string[] = [];
  let selectedIndex = -1;
  for (const block of blockTexts(root)) {
    const pieces = block.text.split('\n');
    let pieceStart = 0;
    const anchorInBlock = block.nodes.includes(anchorNode);
    const beforeAnchor = anchorInBlock
      ? block.nodes.slice(0, block.nodes.indexOf(anchorNode)).reduce((sum, item) => sum + item.data.length, 0) +
        anchorOffset
      : -1;
    for (const piece of pieces) {
      if (piece.trim()) {
        // The anchor sits in this piece when its offset inside the
        // block falls within the piece (or on its final character, at
        // the line break that ends it).
        if (
          selectedIndex === -1 &&
          beforeAnchor >= pieceStart &&
          beforeAnchor <= pieceStart + piece.length
        ) {
          selectedIndex = segments.length;
        }
        segments.push(piece.trim());
      }
      pieceStart += piece.length + 1;
    }
  }
  return selectedIndex === -1 ? null : { segments, selectedIndex };
}

/**
 * A captured document selection: the range to put back, plus the anchor
 * node it was taken from. The range alone cannot tell whether its text
 * is still in the document — a range's boundary points are live, and
 * removing nodes adjusts them to the removal point, so a removed node
 * reads as connected through the range. The anchor node is a plain
 * reference and does not move, so it is the check that the text the
 * selection sat in survived.
 */
export interface CapturedSelection {
  range: Range;
  anchorNode: Node | null;
}

/**
 * The current document selection as a detached range, for restoring
 * the reader's place after a dialog closes. Returns null when there is
 * no selection to keep.
 */
export function captureDocumentSelection(): CapturedSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return { range: selection.getRangeAt(0).cloneRange(), anchorNode: selection.anchorNode };
}

/**
 * Restore a captured document selection. Returns false — and leaves
 * the selection alone — when there is nothing captured, or when the
 * anchor node it was taken from is no longer in the document (the view
 * re-rendered while the dialog was open), so a stale range can never
 * yank the reader to a detached node.
 *
 * A modal dialog destroys the selection it opens over: focusing the
 * dialog's input re-anchors the selection to the input, and when the
 * dialog unmounts that anchor is removed, so the browser collapses the
 * selection to the end of the document (the status bar). The reader's
 * position in the note is lost — the next position bookmark, and
 * Ctrl+Alt+J's "current position", fall back to the first heading
 * instead of the line the reader was on, so a second bookmark made
 * from the same place stores the top of the note and a jump to it
 * lands on the heading before the bookmarked text.
 */
export function restoreDocumentSelection(captured: CapturedSelection | null): boolean {
  if (!captured) return false;
  if (captured.anchorNode && !captured.anchorNode.isConnected) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(captured.range);
  return selection.rangeCount > 0;
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
