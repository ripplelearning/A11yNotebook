import type { PdfPage } from '../../pdf-semantic';

export interface PdfSelectionRange {
  page: number;
  start: number;
  length: number;
}

/** Supports multi-page layers; the current reader mounts only one page at a time. */
export function groupedPdfSelection(
  selection: Selection | Range | null,
  layers: Array<{ page: number; element: HTMLElement }>,
): PdfSelectionRange[] {
  if (!selection) return [];
  const range = selection instanceof Range ? selection : selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || range.collapsed) return [];
  if (
    !layers.some(({ element }) => element.contains(range.startContainer)) ||
    !layers.some(({ element }) => element.contains(range.endContainer))
  )
    return [];
  return layers.flatMap(({ page, element }) => {
    const ranges = Array.from(element.querySelectorAll<HTMLElement>('[data-start-offset]')).flatMap((span) => {
      if (!range.intersectsNode(span)) return [];
      const start = Number(span.dataset.startOffset);
      const end = Number(span.dataset.endOffset);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return [];
      const offsetInSpan = (node: Node, offset: number) => {
        const prefix = span.ownerDocument.createRange();
        prefix.selectNodeContents(span);
        prefix.setEnd(node, offset);
        return Math.min(end - start, prefix.toString().length);
      };
      const from = span.contains(range.startContainer)
        ? start + offsetInSpan(range.startContainer, range.startOffset)
        : start;
      const to = span.contains(range.endContainer) ? start + offsetInSpan(range.endContainer, range.endOffset) : end;
      return to > from ? [{ from, to }] : [];
    });
    if (!ranges.length) return [];
    const start = Math.min(...ranges.map(({ from }) => from));
    return [{ page, start, length: Math.max(...ranges.map(({ to }) => to)) - start }];
  });
}

export function semanticPdfRange(element: Element | null, root: HTMLElement, page: number): PdfSelectionRange | null {
  const block = element?.closest('p,h1,h2,h3,h4,h5,h6,td,th,li,blockquote,[role="heading"],[role="cell"]');
  if (!block || !root.contains(block)) return null;
  const spans = Array.from(block.querySelectorAll<HTMLElement>('[data-start-offset]'));
  if (block.hasAttribute('data-start-offset')) spans.unshift(block as HTMLElement);
  const starts = spans.map((span) => Number(span.dataset.startOffset));
  const ends = spans.map((span) => Number(span.dataset.endOffset));
  if (!starts.length || ![...starts, ...ends].every(Number.isInteger)) return null;
  const start = Math.min(...starts);
  const length = Math.max(...ends) - start;
  return length > 0 ? { page, start, length } : null;
}

export function pdfNoteRectangles(page: PdfPage, start: number, length: number, scale: number, rotation: number) {
  return page.textModel.items.flatMap((item) => {
    const from = Math.max(start, item.startOffset);
    const to = Math.min(start + length, item.endOffset);
    if (to <= from) return [];
    const rectangle = page.highlightAtAnchor(from, to - from, scale, rotation);
    return rectangle ? [rectangle] : [];
  });
}
