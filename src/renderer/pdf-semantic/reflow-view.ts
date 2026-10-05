import type { SemanticNode } from './struct-adapter';
import type { TextModel } from './text-model';
import { HeuristicClassifier, type InferredPage } from './heuristic-classifier';
import { StructAdapter } from './struct-adapter';

export function createReflowView(
  document: Document,
  model: TextModel,
  tree: ConstructorParameters<typeof StructAdapter>[0] | null,
  inferredPage?: InferredPage,
): HTMLElement {
  if (tree) return new StructAdapter(tree, model).toDOM(document);
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
        listItem.textContent = item.text;
        list.append(listItem);
      }
      article.append(list);
      continue;
    }
    if (node.role === 'Quote') {
      const quote = document.createElement('blockquote');
      quote.dataset.classification = node.classification;
      quote.setAttribute('aria-label', node.properties.summary ?? 'Inferred quotation');
      quote.textContent = node.text;
      article.append(quote);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.dataset.classification = node.classification;
    if (node.properties.summary) {
      const label = document.createElement('span');
      label.className = 'pdf-inference-label';
      label.textContent = `${node.properties.summary} `;
      paragraph.append(label);
    }
    paragraph.append(document.createTextNode(node.text));
    article.append(paragraph);
  }
  return article;
}
