import type { TextModel } from './text-model';
import type { SemanticNode } from './struct-adapter';

export interface InferredPage {
  nodes: SemanticNode[];
  marginLines: string[];
  pageNumbers: string[];
}

type Line = { text: string; y?: number; x?: number };

function linesFromModel(model: TextModel): Line[] {
  const lines: Line[] = [];
  let text = '';
  let y: number | undefined;
  for (const item of model.items) {
    if (item.text && y === undefined) {
      y = item.transform?.[5];
    }
    text += item.text;
    if (item.hasEOL) {
      lines.push({ text, y, x: item.transform?.[4] });
      text = '';
      y = undefined;
    }
  }
  if (text) lines.push({ text, y });
  if (!lines.length && model.fullText) lines.push({ text: model.fullText });
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
    const listItems: Line[] = [];
    const isOrderedListItem = (line: Line) => /^\s*\d+[.)]\s+/u.test(line.text);
    const flushList = () => {
      if (!listItems.length) return;
      const ordered = isOrderedListItem(listItems[0]);
      nodes.push({
        role: 'List',
        text: '',
        children: listItems.map((item) => ({
          ...inferredNode(item.text, 'ListItem'),
          properties: { summary: 'Possible list item; inferred.' },
        })),
        properties: { summary: `Possible ${ordered ? 'ordered ' : ''}list; inferred.` },
        markedContentId: null,
        classification: 'inferred',
      });
      listItems.length = 0;
    };
    const pageBounds = model.view;
    const middleLines = lines.filter((line) => {
      const y = line.y ?? 0;
      return (
        y <= pageBounds[3] - (pageBounds[3] - pageBounds[1]) * 0.08 &&
        y >= pageBounds[1] + (pageBounds[3] - pageBounds[1]) * 0.08
      );
    });
    const leftMargin = Math.min(...middleLines.map((line) => line.x ?? 0));

    for (const line of lines) {
      if (/^\s*(?:page\s+\d+(?:\s+of\s+\d+)?|[-—–]\s*\d+\s*[-—–])\s*$/iu.test(line.text)) {
        flushList();
        pageNumbers.push(line.text.trim());
        nodes.push({
          ...inferredNode(line.text),
          properties: { summary: 'Possible printed page number; inferred.' },
        });
      } else if (/^\s*(?:[•▪◦‣]|[-*]|\d+[.)])\s+/u.test(line.text)) {
        if (listItems.length && isOrderedListItem(listItems[0]) !== isOrderedListItem(line)) flushList();
        listItems.push(line);
      } else {
        flushList();
        const [, bottom, , top] = model.view;
        const height = top - bottom;
        if (line.y !== undefined && (line.y > bottom + height * 0.92 || line.y < bottom + height * 0.08)) {
          marginLines.push(line.text.trim());
        }
        if (line.x !== undefined && line.x > leftMargin + 24 && /^\s*[“"'‘]/u.test(line.text)) {
          nodes.push({
            ...inferredNode(line.text, 'Quote'),
            properties: { summary: 'Possible indented quotation; inferred.' },
          });
        } else {
          nodes.push(inferredNode(line.text));
        }
      }
    }
    flushList();
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
        repeated.has(node.text.trim())
          ? { ...node, properties: { ...node.properties, summary: 'Possible repeated margin text; inferred.' } }
          : node,
      );
    }
    return pages;
  }
}
