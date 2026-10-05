import type { SemanticNode } from './struct-adapter';
import type { TextModel } from './text-model';
import { HeuristicClassifier, type InferredPage } from './heuristic-classifier';
import { StructAdapter } from './struct-adapter';
import type { PdfReadingPreferences } from '../../shared/pdf-reading-preferences';
import { DEFAULT_PDF_READING_PREFERENCES } from '../../shared/pdf-reading-preferences';
import { applyPdfReadingPreferences } from './reading-preferences';

export function createReflowView(
  document: Document,
  model: TextModel,
  tree: ConstructorParameters<typeof StructAdapter>[0] | null,
  inferredPage?: InferredPage,
  preferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
): HTMLElement {
  if (tree) return new StructAdapter(tree, model, inferredPage).toDOM(document, preferences);
  const article = document.createElement('article');
  article.setAttribute('aria-label', 'Inferred PDF text');
  const notice = document.createElement('p');
  notice.className = 'pdf-inference-notice';
  notice.textContent = 'Text structure is inferred because this PDF has no tagged structure.';
  article.append(notice);
  const inferred: SemanticNode[] = (inferredPage ?? new HeuristicClassifier().classify(model)).nodes;
  for (const node of inferred) {
    if (node.role === 'List') {
      const list = document.createElement(node.properties.summary?.includes('ordered') ? 'ol' : 'ul');
      list.className = 'pdf-inferred-list';
      list.dataset.classification = node.classification;
      list.setAttribute('aria-label', node.properties.summary ?? 'Inferred list');
      for (const item of node.children) {
        const listItem = document.createElement('li');
        listItem.dataset.classification = item.classification;
        appendText(document, listItem, model, item);
        list.append(listItem);
      }
      article.append(list);
      continue;
    }
    if (node.role === 'Quote') {
      const quote = document.createElement('blockquote');
      quote.dataset.classification = node.classification;
      quote.setAttribute('aria-label', node.properties.summary ?? 'Inferred quotation');
      if (node.artifactType) quote.dataset.pdfArtifactType = node.artifactType;
      appendText(document, quote, model, node);
      article.append(quote);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.dataset.classification = node.classification;
    if (node.artifactType) paragraph.dataset.pdfArtifactType = node.artifactType;
    if (node.properties.summary) {
      const label = document.createElement('span');
      label.className = 'pdf-inference-label';
      label.textContent = `${node.properties.summary} `;
      paragraph.append(label);
    }
    appendText(document, paragraph, model, node);
    article.append(paragraph);
  }
  applyPdfReadingPreferences(article, preferences);
  return article;
}

function appendText(document: Document, parent: HTMLElement, model: TextModel, node: SemanticNode): void {
  if (node.startOffset === undefined || node.endOffset === undefined) {
    parent.append(document.createTextNode(node.text));
    return;
  }
  const startOffset = node.startOffset;
  const endOffset = node.endOffset;
  const explicit = model.items.filter(
    (item) => item.artifactType && item.startOffset < endOffset && item.endOffset > startOffset,
  );
  const offsets = [
    ...new Set([
      startOffset,
      endOffset,
      ...explicit.flatMap((item) => [Math.max(startOffset, item.startOffset), Math.min(endOffset, item.endOffset)]),
    ]),
  ].sort((a, b) => a - b);
  for (let index = 0; index < offsets.length - 1; index++) {
    const start = offsets[index];
    const end = offsets[index + 1];
    const span = document.createElement('span');
    span.dataset.startOffset = String(start);
    span.dataset.endOffset = String(end);
    const type = explicit.find((item) => item.startOffset <= start && item.endOffset >= end)?.artifactType;
    if (type) span.dataset.pdfArtifactType = type;
    span.textContent = model.fullText.slice(start, end);
    parent.append(span);
  }
}
