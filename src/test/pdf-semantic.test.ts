import type { StructTreeNode, TextItem } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it } from 'vitest';
import { HeuristicClassifier } from '../renderer/pdf-semantic/heuristic-classifier';
import { createReflowView } from '../renderer/pdf-semantic/reflow-view';
import { StructAdapter } from '../renderer/pdf-semantic/struct-adapter';
import { getSelectionOffsets, selectTextRange } from '../renderer/pdf-semantic/text-layer';
import { TextModel, type PdfTextPart } from '../renderer/pdf-semantic/text-model';

function textItem(str: string, options: { x?: number; y?: number; hasEOL?: boolean } = {}): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [12, 0, 0, 12, options.x ?? 10, options.y ?? 700],
    width: str.length * 6,
    height: 12,
    fontName: 'fixture',
    hasEOL: options.hasEOL ?? false,
  };
}

describe('canonical PDF text model', () => {
  it('preserves source Unicode and EOLs while normalizing search text', () => {
    const model = new TextModel([
      textItem('office ﬁle cafe\u0301 soft\u00adware ', { hasEOL: true }),
      textItem('second line'),
    ]);
    expect(model.fullText).toBe('office ﬁle cafe\u0301 soft\u00adware \nsecond line');
    expect(model.normalizedText).toBe('office file café software second line');
    expect(model.items.map((item) => item.extractionIndex)).toEqual([0, 1]);

    const [match] = model.findText('café software');
    expect(match?.startOffset).toBe(model.fullText.indexOf('cafe\u0301'));
    expect(model.fullText.slice(match!.startOffset, match!.startOffset + match!.length)).toContain('soft\u00adware');
  });

  it('resolves exact, context-disambiguated, normalized, and missing quotes', () => {
    const model = new TextModel([textItem('start same middle same end soft\u00adhyphen')]);
    expect(model.locateByQuote('start')).toBe(0);
    expect(model.locateByQuote('same')).toBe('ambiguous');
    expect(model.locateByQuote('same', 'middle', ' end')).toBe(model.fullText.indexOf('same', 11));
    expect(model.locateByQuote('softhyphen')).toBe(model.fullText.indexOf('soft\u00adhyphen'));
    expect(model.locateByQuote('absent')).toBe('not found');
    expect(model.extractQuote(0, 5)).toMatchObject({
      exactQuote: 'start',
      normalizedQuote: 'start',
    });
  });

  it('maps offsets and reverse coordinates consistently across scale and rotation', () => {
    const model = new TextModel([textItem('Accessible text', { x: 10, y: 200 })], new Map(), [0, 0, 200, 300], 4);
    const original = model.offsetToCoordinates(0, 1, 0);
    const zoomed = model.offsetToCoordinates(0, 2, 0);
    const rotated = model.offsetToCoordinates(0, 1, 90);
    expect(original).not.toBeNull();
    expect(zoomed?.[0]).toBe(original![0] * 2);
    expect(rotated).not.toEqual(original);
    expect(model.coordinatesToOffset(original![0] + 1, original![1] + 1, 1, 0)).toBeGreaterThanOrEqual(0);
    expect(model.findText('text')[0].page).toBe(4);
  });

  it('maps browser text selection to canonical offsets and can restore the range', () => {
    const model = new TextModel([textItem('select this exact phrase')]);
    const layer = document.createElement('div');
    layer.append(
      ...model.items.map((item) => {
        const span = document.createElement('span');
        span.dataset.startOffset = String(item.startOffset);
        span.dataset.endOffset = String(item.endOffset);
        span.textContent = item.text;
        return span;
      }),
    );
    document.body.append(layer);
    expect(selectTextRange(layer, 7, 4)).toBe(true);
    expect(getSelectionOffsets(layer)).toEqual({ startOffset: 7, length: 4 });
    layer.remove();
  });

  it('adapts semantic roles and table properties while retaining text not owned by the tree', () => {
    const parts = [
      { type: 'beginMarkedContentProps', id: 'heading-id', tag: 'H1' },
      textItem('Document heading'),
      { type: 'endMarkedContent' },
      { type: 'beginMarkedContentProps', id: 'header-id', tag: 'TH' },
      textItem('Name'),
      { type: 'endMarkedContent' },
      { type: 'beginMarkedContentProps', id: 'cell-id', tag: 'TD' },
      textItem('Ada'),
      { type: 'endMarkedContent' },
      textItem('Unowned text'),
    ] as unknown as PdfTextPart[];
    const model = new TextModel(parts);
    const tree = {
      role: 'Document',
      lang: 'en-GB',
      children: [
        { role: 'H1', children: [{ type: 'content', id: 'heading-id' }] },
        {
          role: 'Table',
          summary: 'People',
          children: [
            {
              role: 'TR',
              children: [
                {
                  role: 'TH',
                  structId: 'header-id',
                  scope: 'Column',
                  children: [{ type: 'content', id: 'header-id' }],
                },
                {
                  role: 'TD',
                  headers: ['header-id'],
                  colSpan: 2,
                  children: [{ type: 'content', id: 'cell-id' }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as StructTreeNode;
    const adapter = new StructAdapter(tree, model);
    const semantic = adapter.toDOM(document);
    expect(semantic.querySelector('h1')).toHaveTextContent('Document heading');
    expect(semantic.querySelector('table')).toHaveAttribute('aria-label', 'People');
    expect(semantic.querySelector('th')).toHaveAttribute('scope', 'col');
    expect(semantic.querySelector('th')).toHaveAttribute('lang', 'en-GB');
    expect(semantic.querySelector('td')).toHaveAttribute('headers', 'pdf-header-header-id');
    expect(semantic.querySelector('td')).toHaveAttribute('colspan', '2');
    expect(semantic.querySelector('[data-pdf-untagged]')).toHaveTextContent('Unowned text');
  });

  it('keeps repeated margin text and detected page numbers visible as inferred text', () => {
    const classifier = new HeuristicClassifier();
    const pages = [1, 2, 3].map(
      (page) =>
        new TextModel(
          [
            textItem('Repeated running title', { y: 752, hasEOL: true }),
            textItem(`Page ${page} of 3`, { y: 40, hasEOL: true }),
            textItem(`Body page ${page}`, { y: 600, hasEOL: true }),
          ],
          new Map(),
          [0, 0, 612, 792],
          page,
        ),
    );
    const classified = classifier.classifyPages(pages);
    expect(classified[0].pageNumbers).toEqual(['Page 1 of 3']);
    expect(classified[0].nodes.map((node) => node.text.trim())).toContain('Repeated running title');
    expect(classified[0].nodes[0]).toMatchObject({
      classification: 'inferred',
      properties: { summary: 'Possible repeated margin text; inferred.' },
    });
    const reflow = createReflowView(document, pages[0], null, classified[0]);
    expect(reflow).toHaveTextContent('Possible repeated margin text; inferred.');
    expect(reflow).toHaveTextContent('Page 1 of 3');
  });

  it('only infers obvious bullet/numbered lists and visibly quoted indented lines', () => {
    const model = new TextModel([
      textItem('Ordinary paragraph', { x: 72, y: 700, hasEOL: true }),
      textItem('• First item', { x: 92, y: 680, hasEOL: true }),
      textItem('2. Second item', { x: 92, y: 660, hasEOL: true }),
      textItem('“Quoted words”', { x: 110, y: 640, hasEOL: true }),
    ]);
    const classified = new HeuristicClassifier().classify(model);
    expect(classified.nodes.map((node) => node.role)).toEqual(['P', 'List', 'List', 'Quote']);
    const reflow = createReflowView(document, model, null, classified);
    expect(reflow.querySelector('ul')).toHaveTextContent('• First item');
    expect(reflow.querySelector('ol')).toHaveTextContent('2. Second item');
    expect(reflow.querySelector('blockquote')).toHaveTextContent('Quoted words');
    expect(reflow.querySelector('ol')).toHaveAttribute('aria-label', 'Possible ordered list; inferred.');
  });
});
