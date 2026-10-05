import type { TextModel } from './text-model';

export function createTextLayer(
  model: TextModel,
  document: Document,
  zoom = 1,
  rotation = 0,
): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'pdf-text-layer';
  layer.setAttribute('aria-label', 'Selectable PDF text');
  layer.dataset.zoom = String(zoom);
  layer.dataset.rotation = String(rotation);
  for (const item of model.items) {
    if (!item.text) continue;
    const coordinates = model.offsetToCoordinates(item.startOffset, zoom, rotation);
    if (!coordinates) continue;
    const span = document.createElement('span');
    span.dataset.startOffset = String(item.startOffset);
    span.dataset.endOffset = String(item.endOffset);
    span.textContent = item.text;
    span.style.left = `${coordinates[0]}px`;
    span.style.top = `${coordinates[1]}px`;
    span.style.width = `${coordinates[2]}px`;
    span.style.height = `${coordinates[3]}px`;
    span.style.fontSize = `${Math.max(1, coordinates[3])}px`;
    layer.append(span);
  }
  return layer;
}

export function getSelectionOffsets(layer: HTMLElement): { startOffset: number; length: number } | null {
  const selection = layer.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return null;
  const spans = [...layer.querySelectorAll<HTMLElement>('[data-start-offset]')];
  const startSpan = selection.anchorNode instanceof Element
    ? selection.anchorNode.closest<HTMLElement>('[data-start-offset]')
    : selection.anchorNode.parentElement?.closest<HTMLElement>('[data-start-offset]');
  const endSpan = selection.focusNode instanceof Element
    ? selection.focusNode.closest<HTMLElement>('[data-start-offset]')
    : selection.focusNode.parentElement?.closest<HTMLElement>('[data-start-offset]');
  if (!startSpan || !endSpan || !layer.contains(startSpan) || !layer.contains(endSpan)) return null;
  const anchorIndex = spans.indexOf(startSpan);
  const focusIndex = spans.indexOf(endSpan);
  const first = spans[Math.min(anchorIndex, focusIndex)];
  const last = spans[Math.max(anchorIndex, focusIndex)];
  if (!first || !last) return null;
  const startOffset = Number(first.dataset.startOffset);
  const endOffset = Number(last.dataset.endOffset);
  return { startOffset, length: Math.max(0, endOffset - startOffset) };
}

export function selectTextRange(layer: HTMLElement, startOffset: number, length: number): boolean {
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
