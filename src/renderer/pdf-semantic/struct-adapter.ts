import type { StructTreeNode } from 'pdfjs-dist/types/src/display/api';
import type { MarkedContentRange, TextModel } from './text-model';

export interface SemanticProperties {
  scope?: 'row' | 'col' | 'rowgroup' | 'colgroup';
  headers?: string[];
  colSpan?: number;
  rowSpan?: number;
  language?: string;
  alt?: string;
  summary?: string;
}

export interface SemanticNode {
  role: string;
  text: string;
  children: SemanticNode[];
  properties: SemanticProperties;
  markedContentId: string | null;
  classification?: 'inferred';
}

type TreeContent = { type: string; id: string };
type TreeNode = StructTreeNode & {
  lang?: string;
  alt?: string;
  summary?: string;
  children: Array<TreeNode | TreeContent>;
};

const roleAliases: Record<string, string> = {
  Document: 'Document',
  Div: 'Div',
  P: 'P',
  H: 'H',
  H1: 'H1',
  H2: 'H2',
  H3: 'H3',
  H4: 'H4',
  H5: 'H5',
  H6: 'H6',
  L: 'List',
  List: 'List',
  LI: 'ListItem',
  LBody: 'Div',
  Table: 'Table',
  THead: 'THead',
  TBody: 'TBody',
  TFoot: 'TFoot',
  TR: 'TR',
  TH: 'TH',
  TD: 'TD',
  Link: 'Link',
  Figure: 'Figure',
  Span: 'Span',
  Em: 'Em',
  Strong: 'Strong',
  Code: 'Code',
  BlockQuote: 'Quote',
  Quote: 'Quote',
  Note: 'Note',
  Artifact: 'Artifact',
};

function markedRange(model: TextModel, id: string): MarkedContentRange | undefined {
  return model.markedContentMap.get(id);
}

function rangesText(model: TextModel, ranges: MarkedContentRange[]): string {
  return ranges
    .sort((a, b) => a.startOffset - b.startOffset)
    .map(({ startOffset, endOffset }) => model.fullText.slice(startOffset, endOffset))
    .join('');
}

function semanticProperties(node: TreeNode): SemanticProperties {
  const properties: SemanticProperties = {};
  if (node.scope) {
    const scope = node.scope.toLowerCase();
    if (scope === 'row' || scope === 'column' || scope === 'both') {
      properties.scope = scope === 'column' ? 'col' : scope === 'both' ? 'colgroup' : 'row';
    }
  }
  if (node.headers?.length) properties.headers = node.headers;
  if (Number.isSafeInteger(node.colSpan) && (node.colSpan ?? 0) > 1) properties.colSpan = node.colSpan;
  if (Number.isSafeInteger(node.rowSpan) && (node.rowSpan ?? 0) > 1) properties.rowSpan = node.rowSpan;
  if (node.lang) properties.language = node.lang;
  if (node.alt) properties.alt = node.alt;
  if (node.summary) properties.summary = node.summary;
  return properties;
}

export class StructAdapter {
  constructor(
    private readonly tree: StructTreeNode,
    private readonly textModel: TextModel,
  ) {}

  adapt(): SemanticNode {
    return this.adaptNode(this.tree as TreeNode);
  }

  toDOM(document: Document): HTMLElement {
    const root = document.createElement('article');
    root.setAttribute('aria-label', 'PDF semantic page');
    const semanticTree = this.adapt();
    const ownedRanges = new Set<string>();
    this.appendNode(document, root, semanticTree, ownedRanges);
    const unowned = this.textModel.items.filter(
      (item) => item.text && (!item.markedContentId || !this.textModel.markedContentMap.has(item.markedContentId)),
    );
    if (unowned.length) {
      const unownedText = document.createElement('div');
      unownedText.setAttribute('data-pdf-untagged', 'true');
      unownedText.append(document.createTextNode(unowned.map((item) => item.text).join('')));
      root.append(unownedText);
    }
    return root;
  }

  private adaptNode(node: TreeNode): SemanticNode {
    const children: SemanticNode[] = [];
    const textRanges: MarkedContentRange[] = [];
    let markedContentId: string | null = null;

    for (const child of node.children ?? []) {
      if ('id' in child) {
        markedContentId = child.id;
        const range = markedRange(this.textModel, child.id);
        if (range) {
          textRanges.push(range);
          children.push({
            role: 'Span',
            text: this.textModel.fullText.slice(range.startOffset, range.endOffset),
            children: [],
            properties: {},
            markedContentId: child.id,
          });
        }
      } else {
        children.push(this.adaptNode(child));
      }
    }

    return {
      role: roleAliases[node.role] ?? 'Div',
      text: rangesText(this.textModel, textRanges),
      children,
      properties: semanticProperties(node),
      markedContentId,
    };
  }

  private appendNode(
    document: Document,
    parent: HTMLElement,
    node: SemanticNode,
    ownedRanges: Set<string>,
  ): void {
    const tag = this.htmlTag(node.role);
    const element = document.createElement(tag);
    const properties = node.properties;
    if (properties.language) element.lang = properties.language;
    if (properties.alt) element.setAttribute('aria-label', properties.alt);
    if (properties.scope && (tag === 'th' || tag === 'td')) {
      element.setAttribute('scope', properties.scope);
    }
    if (properties.headers?.length) {
      const ids = properties.headers.map((id) => `pdf-header-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
      element.setAttribute('headers', ids.join(' '));
    }
    if (properties.colSpan) (element as HTMLTableCellElement).colSpan = properties.colSpan;
    if (properties.rowSpan) (element as HTMLTableCellElement).rowSpan = properties.rowSpan;
    if (node.markedContentId) ownedRanges.add(node.markedContentId);
    if (node.text) element.append(document.createTextNode(node.text));
    for (const child of node.children) this.appendNode(document, element, child, ownedRanges);
    parent.append(element);
  }

  private htmlTag(role: string): string {
    const tags: Record<string, string> = {
      Document: 'div',
      Div: 'div',
      P: 'p',
      H1: 'h1',
      H2: 'h2',
      H3: 'h3',
      H4: 'h4',
      H5: 'h5',
      H6: 'h6',
      List: 'ul',
      ListItem: 'li',
      Table: 'table',
      THead: 'thead',
      TBody: 'tbody',
      TFoot: 'tfoot',
      TR: 'tr',
      TH: 'th',
      TD: 'td',
      Link: 'span',
      Figure: 'figure',
      Span: 'span',
      Em: 'em',
      Strong: 'strong',
      Code: 'code',
      Quote: 'blockquote',
      Note: 'aside',
      Artifact: 'div',
    };
    return tags[role] ?? 'div';
  }
}
