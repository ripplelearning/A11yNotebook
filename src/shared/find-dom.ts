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
