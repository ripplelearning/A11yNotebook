import type { StructTreeNode } from 'pdfjs-dist/types/src/display/api';
import type { MarkedContentRange, TextModel } from './text-model';
import type { PdfReadingPreferences } from '../../shared/pdf-reading-preferences';
import { DEFAULT_PDF_READING_PREFERENCES } from '../../shared/pdf-reading-preferences';
import { applyPdfReadingPreferences, explicitPdfArtifactType, type PdfArtifactType } from './reading-preferences';
import { HeuristicClassifier, type InferredPage } from './heuristic-classifier';

export interface SemanticProperties {
  structId?: string;
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
  artifactType?: PdfArtifactType;
  startOffset?: number;
  endOffset?: number;
  marginPosition?: 'header' | 'footer';
}

type TreeContent = { type: string; id: string };
type TreeNode = StructTreeNode & {
  lang?: string;
  alt?: string;
  summary?: string;
  children: Array<TreeNode | TreeContent>;
};

const roleAliases: Record<string, string> = {
  Root: 'Document',
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
  Header: 'Header',
  Footer: 'Footer',
  PageNum: 'PageNum',
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

function semanticProperties(node: TreeNode, inheritedLanguage?: string): SemanticProperties {
  const properties: SemanticProperties = {};
  if (node.scope) {
    const scope = node.scope.toLowerCase();
    if (scope === 'row' || scope === 'column') {
      properties.scope = scope === 'column' ? 'col' : 'row';
    }
  }
  if (node.headers?.length) properties.headers = node.headers;
  if (Number.isSafeInteger(node.colSpan) && (node.colSpan ?? 0) > 1) properties.colSpan = node.colSpan;
  if (Number.isSafeInteger(node.rowSpan) && (node.rowSpan ?? 0) > 1) properties.rowSpan = node.rowSpan;
  if (node.lang || inheritedLanguage) properties.language = node.lang || inheritedLanguage;
  if (node.alt) properties.alt = node.alt;
  if (node.summary) properties.summary = node.summary;
  if (node.structId) properties.structId = node.structId;
  return properties;
}

export class StructAdapter {
  private inferredArtifacts?: InferredPage['artifacts'];
  private readonly explicitArtifacts: InferredPage['artifacts'];

  constructor(
    private readonly tree: StructTreeNode,
    private readonly textModel: TextModel,
    private readonly inferredPage?: InferredPage,
  ) {
    this.explicitArtifacts = textModel.items.flatMap((item) =>
      item.artifactType
        ? [{ startOffset: item.startOffset, endOffset: item.endOffset, artifactType: item.artifactType }]
        : [],
    );
  }

  adapt(): SemanticNode {
    return this.adaptNode(this.tree as TreeNode);
  }

  toDOM(document: Document, preferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES): HTMLElement {
    const root = document.createElement('article');
    root.setAttribute('aria-label', 'PDF semantic page');
    const semanticTree = this.adapt();
    const ownedRanges = new Set<string>();
    this.appendNode(document, root, semanticTree, ownedRanges);
    const unowned = this.textModel.items.filter(
      (item) => item.text && (!item.markedContentId || !ownedRanges.has(item.markedContentId)),
    );
    if (unowned.length) {
      const unownedText = document.createElement('div');
      unownedText.setAttribute('data-pdf-untagged', 'true');
      for (const item of unowned) this.appendRange(document, unownedText, item, true);
      root.append(unownedText);
    }
    applyPdfReadingPreferences(root, preferences);
    return root;
  }

  private adaptNode(node: TreeNode, inheritedLanguage?: string): SemanticNode {
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
            startOffset: range.startOffset,
            endOffset: range.endOffset,
          });
        }
      } else {
        children.push(this.adaptNode(child, node.lang || inheritedLanguage));
      }
    }

    return {
      role: roleAliases[node.role] ?? 'Div',
      text: rangesText(this.textModel, textRanges),
      children,
      properties: semanticProperties(node, inheritedLanguage),
      markedContentId,
      artifactType: explicitPdfArtifactType(node.role),
    };
  }

  private appendNode(
    document: Document,
    parent: HTMLElement,
    node: SemanticNode,
    ownedRanges: Set<string>,
    genericArtifact = false,
  ): void {
    const tag = this.htmlTag(node.role);
    const element = document.createElement(tag);
    const properties = node.properties;
    if (node.role === 'Link') element.dataset.pdfAnnotation = 'link';
    if (node.artifactType) element.dataset.pdfArtifactType = node.artifactType;
    if (properties.language) element.lang = properties.language;
    if (properties.structId && (tag === 'th' || tag === 'td')) {
      element.id = `pdf-header-${properties.structId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    }
    if (properties.summary && tag === 'table') element.setAttribute('aria-label', properties.summary);
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
    if (node.text && !node.children.some((child) => child.markedContentId)) {
      if (node.startOffset !== undefined && node.endOffset !== undefined) {
        this.appendRange(
          document,
          element,
          { startOffset: node.startOffset, endOffset: node.endOffset },
          genericArtifact,
        );
      } else element.append(document.createTextNode(node.text));
    }
    for (const child of node.children) {
      this.appendNode(document, element, child, ownedRanges, genericArtifact || node.role === 'Artifact');
    }
    parent.append(element);
  }

  private appendRange(document: Document, parent: HTMLElement, range: MarkedContentRange, infer: boolean): void {
    const inferred = infer
      ? (this.inferredArtifacts ??= (this.inferredPage ?? new HeuristicClassifier().classify(this.textModel)).artifacts)
      : [];
    const artifacts = [...this.explicitArtifacts, ...inferred];
    const boundaries = new Set([range.startOffset, range.endOffset]);
    for (const artifact of artifacts) {
      if (artifact.startOffset < range.endOffset && artifact.endOffset > range.startOffset) {
        boundaries.add(Math.max(range.startOffset, artifact.startOffset));
        boundaries.add(Math.min(range.endOffset, artifact.endOffset));
      }
    }
    const offsets = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < offsets.length - 1; index++) {
      const startOffset = offsets[index];
      const endOffset = offsets[index + 1];
      const span = document.createElement('span');
      span.dataset.startOffset = String(startOffset);
      span.dataset.endOffset = String(endOffset);
      const artifact = artifacts.find(
        (candidate) => candidate.startOffset <= startOffset && candidate.endOffset >= endOffset,
      );
      if (artifact) span.dataset.pdfArtifactType = artifact.artifactType;
      span.textContent = this.textModel.fullText.slice(startOffset, endOffset);
      parent.append(span);
    }
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
