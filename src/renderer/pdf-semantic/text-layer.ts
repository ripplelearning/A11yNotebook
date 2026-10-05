import type { TextModel } from './text-model';
import { ViewportTransform } from './viewport-transform';

export function createTextLayer(model: TextModel, document: Document, zoom = 1, rotation = 0): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'pdf-text-layer';
  layer.setAttribute('aria-label', 'Selectable PDF text');
  layer.dataset.zoom = String(zoom);
  layer.dataset.rotation = String(rotation);
  const transform = new ViewportTransform(model.view, zoom, rotation);
  for (const item of model.items) {
    if (!item.text) continue;
    if (!item.transform) continue;
    const [, , , , x, y] = item.transform;
    const [left, baseline] = transform.pdfPoint(x, y);
    const height = (item.height || Math.abs(item.transform[0]) || 12) * zoom;
    const [advanceX, advanceY] = transform.pdfPoint(x + item.transform[0], y + item.transform[1]);
    const angle = (Math.atan2(advanceY - baseline, advanceX - left) * 180) / Math.PI;
    const span = document.createElement('span');
    span.dataset.startOffset = String(item.startOffset);
    span.dataset.endOffset = String(item.endOffset);
    span.textContent = item.text;
    span.style.left = `${left}px`;
    span.style.top = `${baseline - height}px`;
    span.style.width = `${item.width * zoom}px`;
    span.style.height = `${height}px`;
    span.style.fontSize = `${Math.max(1, height)}px`;
    span.style.transform = `rotate(${angle}deg)`;
    span.style.transformOrigin = `left ${height}px`;
    layer.append(span);
  }
  return layer;
}

export function getSelectionOffsets(layer: HTMLElement): { startOffset: number; length: number } | null {
  const selection = layer.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const spanFor = (node: Node): HTMLElement | null => {
    const element = node instanceof Element ? node : node.parentElement;
    const span = element?.closest<HTMLElement>('[data-start-offset]');
    return span && layer.contains(span) ? span : null;
  };
  const startSpan = spanFor(range.startContainer);
  const endSpan = spanFor(range.endContainer);
  if (!startSpan || !endSpan) return null;
  const startOffset = Number(startSpan.dataset.startOffset) + range.startOffset;
  const endOffset = Number(endSpan.dataset.startOffset) + range.endOffset;
  return { startOffset, length: Math.max(0, endOffset - startOffset) };
}

export function selectTextRange(layer: HTMLElement, startOffset: number, length: number): boolean {
  if (length <= 0) return false;
  const spans = [...layer.querySelectorAll<HTMLElement>('[data-start-offset]')];
  const first = spans.find(
    (span) => startOffset >= Number(span.dataset.startOffset) && startOffset < Number(span.dataset.endOffset),
  );
  const lastOffset = startOffset + Math.max(0, length - 1);
  const last = spans.find(
    (span) => lastOffset >= Number(span.dataset.startOffset) && lastOffset < Number(span.dataset.endOffset),
  );
  if (!first || !last) return false;
  const firstText = first.firstChild;
  const lastText = last.firstChild;
  if (!firstText || !lastText) return false;
  const start = layer.ownerDocument.createRange();
  start.setStart(firstText, startOffset - Number(first.dataset.startOffset));
  const end = layer.ownerDocument.createRange();
  end.setEnd(lastText, lastOffset - Number(last.dataset.startOffset) + 1);
  const selection = layer.ownerDocument.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  const range = layer.ownerDocument.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.endContainer, end.endOffset);
  selection.addRange(range);
  return true;
}
