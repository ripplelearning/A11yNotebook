import type { TextModel } from './text-model';
import type { SemanticNode } from './struct-adapter';
import type { PdfArtifactType } from './reading-preferences';

export interface InferredPage {
  nodes: SemanticNode[];
  marginLines: string[];
  pageNumbers: string[];
  artifacts: Array<{ startOffset: number; endOffset: number; artifactType: PdfArtifactType }>;
}

type Line = { text: string; y?: number; x?: number; startOffset: number; endOffset: number };

function linesFromModel(model: TextModel): Line[] {
  const lines: Line[] = [];
  let text = '';
  let y: number | undefined;
  let x: number | undefined;
  let startOffset = 0;
  for (const item of model.items) {
    if (item.text && !text) {
      y = item.transform?.[5];
      x = item.transform?.[4];
      startOffset = item.startOffset;
    }
    text += item.text;
    if (item.hasEOL) {
      lines.push({ text, y, x, startOffset, endOffset: item.endOffset });
      text = '';
      y = undefined;
    }
  }
  if (text) lines.push({ text, y, x, startOffset, endOffset: model.fullText.length });
  if (!lines.length && model.fullText)
    lines.push({ text: model.fullText, startOffset: 0, endOffset: model.fullText.length });
  return lines;
}

function inferredNode(line: Line, role = 'P'): SemanticNode {
  return { role, ...line, children: [], properties: {}, markedContentId: null, classification: 'inferred' };
}

function marginPosition(model: TextModel, line: Line): 'header' | 'footer' | undefined {
  const [, bottom, , top] = model.view;
  const height = top - bottom;
  const items = model.items.filter(
    (item) => item.startOffset < line.endOffset && item.endOffset > line.startOffset && item.text.trim(),
  );
  if (!items.length || height <= 0) return undefined;
  if (items.every((item) => item.transform && item.transform[5] > bottom + height * 0.92 && item.transform[5] <= top))
    return 'header';
  if (
    items.every((item) => item.transform && item.transform[5] < bottom + height * 0.08 && item.transform[5] >= bottom)
  )
    return 'footer';
  return undefined;
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
          ...inferredNode(item, 'ListItem'),
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
      const position = marginPosition(model, line);
      const items = model.items.filter(
        (item) => item.startOffset < line.endOffset && item.endOffset > line.startOffset && item.text.trim(),
      );
      const explicitType = items[0]?.artifactType;
      if (explicitType && items.every((item) => item.artifactType === explicitType)) {
        flushList();
        nodes.push({ ...inferredNode(line), artifactType: explicitType });
        if (explicitType === 'page-number') pageNumbers.push(line.text.trim());
      } else if (position && /^\s*(?:\d+|page\s+\d+(?:\s+of\s+\d+)?|[-—–]\s*\d+\s*[-—–])\s*$/iu.test(line.text)) {
        flushList();
        pageNumbers.push(line.text.trim());
        nodes.push({
          ...inferredNode(line),
          artifactType: 'page-number',
          properties: { summary: 'Possible printed page number; inferred.' },
        });
      } else if (/^\s*(?:[•▪◦‣]|[-*]|\d+[.)])\s+/u.test(line.text)) {
        if (listItems.length && isOrderedListItem(listItems[0]) !== isOrderedListItem(line)) flushList();
        listItems.push(line);
      } else {
        flushList();
        if (position) {
          marginLines.push(line.text.trim());
        }
        if (line.x !== undefined && line.x > leftMargin + 24 && /^\s*[“"'‘]/u.test(line.text)) {
          nodes.push({
            ...inferredNode(line, 'Quote'),
            marginPosition: position,
            properties: { summary: 'Possible indented quotation; inferred.' },
          });
        } else {
          nodes.push({ ...inferredNode(line), marginPosition: position });
        }
      }
    }
    flushList();
    return { nodes, marginLines, pageNumbers, artifacts: artifactRanges(nodes) };
  }

  classifyPages(models: TextModel[]): InferredPage[] {
    const pages = models.map((model) => this.classify(model));
    const counts = new Map<string, number>();
    for (const page of pages) {
      for (const text of new Set(
        page.nodes.filter((node) => node.marginPosition).map((node) => `${node.marginPosition}:${node.text.trim()}`),
      )) {
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }
    for (const page of pages) {
      const repeated = new Set([...counts].filter(([, count]) => count >= 3).map(([text]) => text));
      page.nodes = page.nodes.map((node) =>
        node.marginPosition && repeated.has(`${node.marginPosition}:${node.text.trim()}`)
          ? {
              ...node,
              artifactType: node.marginPosition,
              properties: { ...node.properties, summary: 'Possible repeated margin text; inferred.' },
            }
          : node,
      );
      page.artifacts = artifactRanges(page.nodes);
    }

    return pages;
  }
}

function artifactRanges(nodes: SemanticNode[]): InferredPage['artifacts'] {
  return nodes.flatMap((node) =>
    node.artifactType && node.startOffset !== undefined && node.endOffset !== undefined
      ? [{ startOffset: node.startOffset, endOffset: node.endOffset, artifactType: node.artifactType }]
      : [],
  );
}
