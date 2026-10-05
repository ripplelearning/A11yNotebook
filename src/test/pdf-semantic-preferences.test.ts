import type { PDFPageProxy, StructTreeNode, TextItem } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PDF_READING_PREFERENCES } from '../shared/pdf-reading-preferences';
import { HeuristicClassifier } from '../renderer/pdf-semantic/heuristic-classifier';
import { PdfPage } from '../renderer/pdf-semantic/pdf-document';
import { applyPdfReadingPreferences } from '../renderer/pdf-semantic/reading-preferences';
import { createReflowView } from '../renderer/pdf-semantic/reflow-view';
import { StructAdapter } from '../renderer/pdf-semantic/struct-adapter';
import { getSelectionOffsets, selectTextRange } from '../renderer/pdf-semantic/text-layer';
import { TextModel, type PdfTextPart } from '../renderer/pdf-semantic/text-model';

const both = { hideHeadersFooters: true, hidePageNumbers: true };
const headersOnly = { hideHeadersFooters: true, hidePageNumbers: false };
const numbersOnly = { hideHeadersFooters: false, hidePageNumbers: true };

function item(str: string, y = 400, hasEOL = true): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [12, 0, 0, 12, 72, y],
    width: str.length * 6,
    height: 12,
    fontName: 'fixture',
    hasEOL,
  };
}

function marked(tag: string, id: string, text: string, y = 400): PdfTextPart[] {
  return [{ type: 'beginMarkedContentProps', tag, id }, item(text, y), { type: 'endMarkedContent', id }];
}

function tree(roles: Array<[string, string]>): StructTreeNode {
  return { role: 'Document', children: roles.map(([role, id]) => ({ role, children: [{ type: 'content', id }] })) };
}

function artifacts(root: HTMLElement, type: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-pdf-artifact-type="${type}"]`)];
}

describe('PDF semantic reading preferences', () => {
  it('defaults to exposure and independently, reversibly filters explicit marked tags and structure roles', () => {
    const model = new TextModel([
      ...marked('Header', 'head', 'Running header'),
      ...marked('Span', 'foot', 'Running footer'),
      ...marked('PageNum', 'number', '7'),
      ...marked('Artifact', 'generic', 'Important content'),
      item('Unowned body'),
    ]);
    const root = new StructAdapter(
      tree([
        ['P', 'head'],
        ['Footer', 'foot'],
        ['Artifact', 'generic'],
      ]),
      model,
    ).toDOM(document);
    const text = root.textContent;
    expect(root.querySelector('[aria-hidden]')).toBeNull();
    expect(artifacts(root, 'header')[0]).toHaveTextContent('Running header');
    expect(artifacts(root, 'footer')[0]).toHaveTextContent('Running footer');
    expect(artifacts(root, 'page-number')[0]).toHaveTextContent('7');
    expect(root.querySelector('[data-pdf-untagged]')).toHaveTextContent('Unowned body');
    applyPdfReadingPreferences(root, headersOnly);
    expect(artifacts(root, 'header')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(artifacts(root, 'footer')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(artifacts(root, 'page-number')[0]).not.toHaveAttribute('aria-hidden');
    applyPdfReadingPreferences(root, numbersOnly);
    expect(artifacts(root, 'header')[0]).not.toHaveAttribute('aria-hidden');
    expect(artifacts(root, 'footer')[0]).not.toHaveAttribute('aria-hidden');
    expect(artifacts(root, 'page-number')[0]).toHaveAttribute('aria-hidden', 'true');
    applyPdfReadingPreferences(root, DEFAULT_PDF_READING_PREFERENCES);
    expect(root.querySelector('[hidden], [aria-hidden]')).toBeNull();
    expect(root.textContent).toBe(text);
    expect(root).toHaveTextContent('Important content');
  });

  it('recognizes Header/Footer/PageNum structure roles without treating table headers or generic Artifacts as artifacts', () => {
    const roles: Array<[string, string]> = [
      ['Header', 'h'],
      ['Footer', 'f'],
      ['PageNum', 'n'],
      ['TH', 'th'],
      ['TFoot', 'tf'],
      ['Artifact', 'a'],
    ];
    const model = new TextModel(roles.flatMap(([role, id]) => marked('Span', id, role)));
    const root = new StructAdapter(tree(roles), model).toDOM(document, both);
    expect(artifacts(root, 'header')).toHaveLength(1);
    expect(artifacts(root, 'footer')).toHaveLength(1);
    expect(artifacts(root, 'page-number')).toHaveLength(1);
    expect(root.querySelector('th')).not.toHaveAttribute('aria-hidden');
    expect(root.querySelector('tfoot')).not.toHaveAttribute('aria-hidden');
    expect(root.textContent).toContain('Artifact');
    expect(root.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(root.querySelector('[hidden]')).toBeNull();
  });

  it('infers page numbers only in margins, and repeated headers/footers only at the matching margin position', () => {
    const models = [1, 2, 3, 4].map(
      (page) =>
        new TextModel([
          item('Repeated title', page === 4 ? 400 : 760),
          item('Repeated footer', 20),
          item(`Page ${page} of 4`, 40),
          item('Repeated body', 500),
          item('Page 10 of 20', 450),
          item('123', 420),
          item('Unique margin', page === 1 ? 750 : 600),
        ]),
    );
    const pages = new HeuristicClassifier().classifyPages(models);
    expect(pages[0].artifacts.map((range) => range.artifactType)).toEqual(['header', 'footer', 'page-number']);
    expect(pages[3].artifacts.map((range) => range.artifactType)).toEqual(['footer', 'page-number']);
    const root = createReflowView(document, models[0], null, pages[0], both);
    expect(artifacts(root, 'header')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(artifacts(root, 'footer')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(artifacts(root, 'page-number')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('p[aria-hidden="true"]')).toHaveLength(3);
    expect(pages[0].pageNumbers).toEqual(['Page 1 of 4']);
    expect(pages[0].nodes.find((node) => node.text.trim() === 'Unique margin')?.artifactType).toBeUndefined();
    const noPosition = new TextModel([{ ...item('Page 1'), transform: [] }]);
    expect(new HeuristicClassifier().classify(noPosition).artifacts).toEqual([]);
  });

  it('matches inferred ranges within tagged generic Artifacts and unowned content without hiding unmatched/body text', () => {
    const models = [1, 2, 3].map(
      (page) =>
        new TextModel([
          ...marked('Artifact', 'mixed', 'Repeated title', 760),
          ...marked('Artifact', 'mixed', 'Unmatched body', 400),
          item('Repeated footer', 20),
          ...marked('Artifact', 'num', String(page), 40),
          ...marked('P', 'body', 'Repeated title', 500),
        ]),
    );
    const pages = new HeuristicClassifier().classifyPages(models);
    const root = new StructAdapter(
      tree([
        ['Artifact', 'mixed'],
        ['Artifact', 'num'],
        ['P', 'body'],
      ]),
      models[0],
      pages[0],
    ).toDOM(document, both);
    expect(root.textContent).toBe(models[0].fullText.replace('Repeated footer\n', '') + 'Repeated footer\n');
    expect(artifacts(root, 'header')).toHaveLength(1);
    expect(artifacts(root, 'footer')).toHaveLength(1);
    expect(artifacts(root, 'page-number')).toHaveLength(1);
    expect(root.querySelector('p')).not.toHaveAttribute('aria-hidden');
    expect(
      [...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].map((node) => node.textContent?.trim()),
    ).toEqual(['Repeated title', '1', 'Repeated footer']);
    expect(
      [...root.querySelectorAll('span')].find((node) => node.textContent === 'Unmatched body\n'),
    ).not.toHaveAttribute('aria-hidden');
  });

  it('protects focusable, focused and annotated descendants and ancestors, and restores previous exposure', () => {
    const root = document.createElement('article');
    root.innerHTML = `
      <div data-pdf-artifact-type="header"><button>Action</button></div>
      <div data-pdf-artifact-type="footer"><span tabindex="-1">Focus</span></div>
      <div data-pdf-artifact-type="header"><mark data-annotation-id="note">Annotation</mark></div>
      <mark data-annotation-id="outer"><span data-pdf-artifact-type="page-number">1</span></mark>
      <div data-pdf-artifact-type="header" aria-hidden="false">Plain</div>
      <div data-pdf-artifact-type="footer" hidden aria-hidden="true">Already hidden</div>`;
    document.body.append(root);
    const focus = root.querySelector<HTMLElement>('[tabindex]')!;
    focus.focus();
    focus.removeAttribute('tabindex');
    applyPdfReadingPreferences(root, both);
    expect(root.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(root.querySelectorAll('[hidden]')).toHaveLength(1);
    expect(document.activeElement).toBe(focus);
    applyPdfReadingPreferences(root, DEFAULT_PDF_READING_PREFERENCES);
    expect(root.querySelectorAll('[hidden]')).toHaveLength(1);
    expect(root.querySelector('[aria-hidden="false"]')).toHaveTextContent('Plain');
    root.remove();
  });

  it('retains explicit marked fragments on mixed untagged lines and preserves reflow selections', () => {
    const model = new TextModel([
      { type: 'beginMarkedContent', id: '', tag: 'Header' },
      item('Title ', 760, false),
      { type: 'endMarkedContent', id: '' },
      item('Body phrase', 400),
    ]);
    const root = createReflowView(document, model, null, undefined, headersOnly);
    expect(artifacts(root, 'header')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelector('p:not(.pdf-inference-notice)')).not.toHaveAttribute('aria-hidden');
    document.body.append(root);
    expect(selectTextRange(root, 6, 4)).toBe(true);
    expect(getSelectionOffsets(root)).toEqual({ startOffset: 6, length: 4 });
    applyPdfReadingPreferences(root, DEFAULT_PDF_READING_PREFERENCES);
    expect(root.textContent).toContain(model.fullText);
    root.remove();
  });

  it('protects native semantic link regions within explicit artifact roles', () => {
    const model = new TextModel(marked('Header', 'link', 'Important link'));
    const structure = {
      role: 'Header',
      children: [{ role: 'Link', children: [{ type: 'content', id: 'link' }] }],
    } as StructTreeNode;
    const root = new StructAdapter(structure, model).toDOM(document, both);
    expect(root.querySelector('[aria-hidden]')).toBeNull();
    expect(root.querySelector('[data-pdf-annotation]')).toHaveTextContent('Important link');
  });

  it('keeps canonical text, matches, offsets, node identity and body selections stable through live toggles', () => {
    const model = new TextModel([
      ...marked('Header', 'h', 'Title', 760),
      item('Exact body phrase'),
      ...marked('PageNum', 'n', '1', 20),
    ]);
    const root = new StructAdapter(tree([['Header', 'h']]), model).toDOM(document);
    document.body.append(root);
    const match = model.findText('body')[0];
    const body = root.querySelector(`[data-start-offset="${'Title\n'.length}"]`);
    expect(selectTextRange(root, match.startOffset, match.length)).toBe(true);
    const before = root.textContent;
    applyPdfReadingPreferences(root, both);
    expect(getSelectionOffsets(root)).toEqual({ startOffset: match.startOffset, length: match.length });
    expect(model.findText('body')[0]).toEqual(match);
    expect(root.textContent).toBe(before);
    expect(root.querySelector(`[data-start-offset="${'Title\n'.length}"]`)).toBe(body);
    applyPdfReadingPreferences(root, DEFAULT_PDF_READING_PREFERENCES);
    expect(getSelectionOffsets(root)).toEqual({ startOffset: match.startOffset, length: match.length });
    root.remove();
  });

  it('accepts and retains page preferences while preserving the existing zoom/rotation call', async () => {
    const source = {
      rotate: 0,
      view: [0, 0, 612, 792],
      getTextContent: async () => ({ items: [...marked('Header', 'h', 'Title'), ...marked('PageNum', 'n', '1')] }),
      getStructTree: async () => null,
      getAnnotations: async () => [],
    } as unknown as PDFPageProxy;
    const page = await PdfPage.create(source, 1, undefined, headersOnly);
    expect(artifacts(page.getSemanticDOM(), 'header')[0]).toHaveAttribute('aria-hidden', 'true');
    const root = page.getSemanticDOM(2, 90, numbersOnly);
    expect(root.dataset.zoom).toBe('2');
    expect(root.dataset.rotation).toBe('90');
    expect(artifacts(root, 'header')[0]).not.toHaveAttribute('aria-hidden');
    expect(artifacts(page.getSemanticDOM(), 'page-number')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(page.getSemanticDOM(DEFAULT_PDF_READING_PREFERENCES).querySelector('[aria-hidden]')).toBeNull();
    page.setReadingPreferences(both);
    expect(artifacts(page.getSemanticDOM(), 'header')[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks and live-filters tagged visual text spans without replacing the layer or changing body offsets', async () => {
    const source = {
      rotate: 0,
      view: [0, 0, 612, 792],
      getTextContent: async () => ({
        items: [
          ...marked('Span', 'h', 'Header', 760),
          item('Body phrase', 400),
          ...marked('PageNum', 'n', '1', 20),
          ...marked('Artifact', 'a', 'Generic body', 300),
        ],
      }),
      getStructTree: async () =>
        tree([
          ['Header', 'h'],
          ['Artifact', 'a'],
        ]),
      getAnnotations: async () => [],
    } as unknown as PDFPageProxy;
    const page = await PdfPage.create(source, 1, undefined, headersOnly);
    const layer = page.getTextLayer(2, 90);
    const body = layer.querySelector('[data-start-offset="7"]');
    const text = layer.textContent;
    expect(layer).not.toHaveAttribute('hidden');
    expect(layer).not.toHaveAttribute('aria-hidden');
    expect(artifacts(layer, 'header')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(artifacts(layer, 'page-number')[0]).not.toHaveAttribute('aria-hidden');
    expect(layer.querySelector('[hidden]')).toBeNull();
    document.body.append(layer);
    expect(page.selectTextRange(7, 4, layer)).toBe(true);
    applyPdfReadingPreferences(layer, numbersOnly);
    expect(artifacts(layer, 'header')[0]).not.toHaveAttribute('aria-hidden');
    expect(artifacts(layer, 'page-number')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(layer.querySelector('[hidden]')).toBeNull();
    expect(layer.querySelector('[data-start-offset="7"]')).toBe(body);
    expect(page.getTextSelection(layer)).toEqual({ startOffset: 7, length: 4 });
    expect(layer.textContent).toBe(text);
    expect([...layer.children].find((span) => span.textContent === 'Generic body\n')).not.toHaveAttribute(
      'aria-hidden',
    );
    applyPdfReadingPreferences(layer, DEFAULT_PDF_READING_PREFERENCES);
    expect(layer.querySelector('[aria-hidden]')).toBeNull();
    layer.remove();
  });

  it('marks inferred repeated-margin and page-number visual spans while retaining repeated body text', async () => {
    const models = [1, 2, 3].map(
      (number) =>
        new TextModel([
          item('Running title', 760),
          item('Body phrase', 400),
          item(String(number), 20),
          item('Running title', 300),
        ]),
    );
    const classified = new HeuristicClassifier().classifyPages(models);
    const source = {
      rotate: 0,
      view: [0, 0, 612, 792],
      getTextContent: async () => ({
        items: [item('Running title', 760), item('Body phrase', 400), item('1', 20), item('Running title', 300)],
      }),
      getStructTree: async () => null,
      getAnnotations: async () => [],
    } as unknown as PDFPageProxy;
    const page = await PdfPage.create(source, 1, undefined, both);
    page.setInferredPage(classified[0]);
    const layer = page.getTextLayer();
    expect(artifacts(layer, 'header')).toHaveLength(1);
    expect(artifacts(layer, 'page-number')).toHaveLength(1);
    expect(layer.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(layer.querySelector('[hidden]')).toBeNull();
    expect(layer.lastElementChild).not.toHaveAttribute('aria-hidden');
    applyPdfReadingPreferences(layer, DEFAULT_PDF_READING_PREFERENCES);
    expect(layer.querySelector('[aria-hidden]')).toBeNull();
  });
});
