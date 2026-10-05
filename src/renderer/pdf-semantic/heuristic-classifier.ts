import type { TextModel } from './text-model';
import type { SemanticNode } from './struct-adapter';

export interface InferredPage {
  nodes: SemanticNode[];
  marginLines: string[];
  pageNumbers: string[];
}

type Line = { text: string; startOffset: number; y?: number };

function linesFromModel(model: TextModel): Line[] {
  const lines: Line[] = [];
  let startOffset = 0;
  for (const item of model.items) {
    const lineText = item.text.replace(/\n$/, '');
    if (lineText.trim()) {
      lines.push({
        text: lineText,
        startOffset: item.startOffset,
        y: item.transform?.[5],
      });
    }
    if (item.hasEOL) startOffset = item.endOffset;
  }
  if (!lines.length && model.fullText.trim()) lines.push({ text: model.fullText.trim(), startOffset: 0 });
  return lines;
}

function inferredNode(text: string, role = 'P'): SemanticNode {
  return { role, text, children: [], properties: {}, markedContentId: null, classification: 'inferred' };
}

export class HeuristicClassifier {
  classify(model: TextModel): InferredPage {
    const lines = linesFromModel(model);
    const marginLines: string[] = [];
    const pageNumbers: string[] = [];
    const nodes: SemanticNode[] = [];
    for (const line of lines) {
      if (/^\s*(?:page\s+\d+(?:\s+of\s+\d+)?|[-—–]\s*\d+\s*[-—–])\s*$/iu.test(line.text)) {
        pageNumbers.push(line.text);
        nodes.push(inferredNode(line.text));
      } else {
        if (line.y !== undefined && line.y > model.items[0]?.transform?.[5]! + 1) marginLines.push(line.text);
        nodes.push(inferredNode(line.text));
      }
    }
    return { nodes, marginLines, pageNumbers };
  }

  classifyPages(models: TextModel[]): InferredPage[] {
    const pages = models.map((model) => this.classify(model));
    const counts = new Map<string, number>();
    for (const page of pages) {
      for (const text of new Set(page.marginLines)) counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    for (const page of pages) {
      const repeated = new Set([...counts].filter(([, count]) => count >= 3).map(([text]) => text));
      page.nodes = page.nodes.map((node) =>
        repeated.has(node.text)
          ? { ...node, properties: { ...node.properties, summary: 'Possible repeated margin text; inferred.' } }
          : node,
      );
    }
    return pages;
  }
}
