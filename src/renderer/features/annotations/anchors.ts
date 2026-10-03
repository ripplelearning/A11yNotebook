import { ANNOTATION_LIMITS, type AnnotationAnchor, type NoteAnnotation } from '../../../shared/annotations';

function textNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('script, style, textarea, [data-annotation-description]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

export function documentText(root: HTMLElement): string {
  return textNodes(root).map((node) => node.data).join('');
}

export function captureAnnotationAnchor(root: HTMLElement, selection: Selection | null): AnnotationAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const nodes = textNodes(root);
  let position = 0;
  let start = -1;
  let end = -1;
  // Range comparisons also handle selection boundaries that are element offsets.
  for (const node of nodes) {
    for (const [boundary, isStart] of [[range.startContainer, true], [range.endContainer, false]] as const) {
      if (boundary === node) {
        if (isStart) start = position + range.startOffset;
        else end = position + range.endOffset;
      }
    }
    position += node.length;
  }
  const offsetAt = (container: Node, offset: number) => {
    const before = root.ownerDocument.createRange();
    before.setStart(root, 0);
    before.setEnd(container, offset);
    return nodes.reduce((total, node) => {
      return before.comparePoint(node, node.length) <= 0 ? total + node.length : total;
    }, 0);
  };
  if (start < 0) start = offsetAt(range.startContainer, range.startOffset);
  if (end < 0) end = offsetAt(range.endContainer, range.endOffset);
  const text = nodes.map((node) => node.data).join('');
  const quote = text.slice(start, end);
  if (!quote.trim() || quote.length > ANNOTATION_LIMITS.quote) return null;
  return {
    quote, start, end,
    prefix: text.slice(Math.max(0, start - ANNOTATION_LIMITS.context), start),
    suffix: text.slice(end, end + ANNOTATION_LIMITS.context),
  };
}

/** Never guess between repeated quotations: context must identify a single occurrence. */
export function resolveAnnotationAnchor(text: string, anchor: AnnotationAnchor): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  const candidates: number[] = [];
  for (let index = text.indexOf(anchor.quote); index !== -1; index = text.indexOf(anchor.quote, index + 1)) {
    candidates.push(index);
  }
  if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + anchor.quote.length };
  const contextual = candidates.filter((start) =>
    (!anchor.prefix || text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) &&
    (!anchor.suffix || text.slice(start + anchor.quote.length, start + anchor.quote.length + anchor.suffix.length) === anchor.suffix),
  );
  if (contextual.length !== 1) return null;
  return { start: contextual[0], end: contextual[0] + anchor.quote.length };
}

export function clearAnnotationMarks(root: HTMLElement): void {
  root.querySelectorAll('mark[data-annotation-id]').forEach((mark) => {
    mark.replaceWith(...Array.from(mark.childNodes));
  });
  root.normalize();
}

const backgrounds = { yellow: '#fff0a6', green: '#c7efc8', blue: '#cce6ff', pink: '#ffd5e5' };

/** Split text nodes in place, preserving links and emphasis and never interpreting annotation strings as HTML. */
export function renderAnnotationMarks(root: HTMLElement, annotations: NoteAnnotation[]): Set<string> {
  clearAnnotationMarks(root);
  const text = documentText(root);
  const resolved = annotations.flatMap((annotation) => {
    const range = resolveAnnotationAnchor(text, annotation.anchor);
    return range ? [{ annotation, ...range }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: typeof resolved = [];
  for (const range of resolved) {
    if (accepted.length && range.start < accepted[accepted.length - 1].end) continue;
    accepted.push(range);
  }
  const nodes = textNodes(root);
  let offset = 0;
  for (const node of nodes) {
    const length = node.length;
    // Right-to-left splits keep all offsets relative to the original text node.
    for (const range of [...accepted].reverse()) {
      const start = Math.max(0, range.start - offset);
      const end = Math.min(length, range.end - offset);
      if (start >= end) continue;
      const selected = node.splitText(start);
      selected.splitText(end - start);
      const mark = root.ownerDocument.createElement('mark');
      mark.dataset.annotationId = range.annotation.id;
      mark.tabIndex = -1;
      mark.style.backgroundColor = backgrounds[range.annotation.color];
      mark.style.color = '#171717';
      mark.setAttribute('aria-description', `${range.annotation.color} highlight: ${range.annotation.label}${range.annotation.comment ? `. ${range.annotation.comment}` : ''}`);
      mark.title = `${range.annotation.label}${range.annotation.comment ? `: ${range.annotation.comment}` : ''}`;
      selected.replaceWith(mark);
      mark.append(selected);
    }
    offset += length;
  }
  return new Set(accepted.map((item) => item.annotation.id));
}

export function jumpToAnnotation(root: HTMLElement, id: string): boolean {
  const mark = Array.from(root.querySelectorAll<HTMLElement>('mark[data-annotation-id]'))
    .find((element) => element.dataset.annotationId === id);
  if (!mark) return false;
  mark.scrollIntoView?.({ block: 'center' });
  mark.focus();
  return true;
}
