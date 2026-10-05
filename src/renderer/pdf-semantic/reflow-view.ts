import type { SemanticNode } from './struct-adapter';
import type { TextModel } from './text-model';
import { HeuristicClassifier } from './heuristic-classifier';
import { StructAdapter } from './struct-adapter';

export function createReflowView(
  document: Document,
  model: TextModel,
  tree: ConstructorParameters<typeof StructAdapter>[0] | null,
): HTMLElement {
  if (tree) return new StructAdapter(tree, model).toDOM(document);
  const article = document.createElement('article');
  article.setAttribute('aria-label', 'Inferred PDF text');
  const inferred: SemanticNode[] = new HeuristicClassifier().classify(model).nodes;
  for (const node of inferred) {
    const paragraph = document.createElement('p');
    paragraph.dataset.classification = node.classification;
    paragraph.textContent = node.text;
    article.append(paragraph);
  }
  return article;
}
