// @vitest-environment node
/**
 * Phase 0 spike evidence: pins what the installed pdfjs-dist actually exposes so the
 * structure/artifact design fails loudly if a PDF.js upgrade changes behaviour.
 * See docs/pdf-artifact-spike.md.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import {
  ligatureAndHyphenation,
  linkedDocument,
  rotatedPage,
  scannedPage,
  taggedReport,
} from './fixtures/pdf-fixtures';

async function open(data: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, useSystemFonts: false, verbosity: 0, enableXfa: false });
  return { task, pdf: await task.promise, version: pdfjs.version };
}

type MarkedItem = TextMarkedContent & { tag?: string | null };

describe('pinned pdf.js capabilities (Phase 0 spike evidence)', () => {
  it('is the audited version', async () => {
    const { task, version } = await open(rotatedPage());
    expect(version).toBe('6.4.299');
    await task.destroy();
  });

  it('exposes Artifact tags but not their /Type or /Subtype (Header, Footer, PageNum)', async () => {
    const { task, pdf } = await open(taggedReport());
    const content = await (await pdf.getPage(1)).getTextContent({ includeMarkedContent: true });
    const artifacts = content.items.filter(
      (item): item is MarkedItem => 'type' in item && (item as MarkedItem).tag === 'Artifact',
    );
    expect(artifacts).toHaveLength(3);
    for (const item of artifacts) {
      expect(item).toEqual({ type: 'beginMarkedContentProps', id: null, tag: 'Artifact' });
    }
    await task.destroy();
  });

  it('maps struct tree content ids to marked-content ids and exposes headings, lists, tables, alt and lang', async () => {
    const { task, pdf } = await open(taggedReport());
    const page = await pdf.getPage(2);
    const content = await page.getTextContent({ includeMarkedContent: true });
    const ids = content.items.flatMap((item) => ('id' in item && item.id ? [item.id] : []));
    const tree = JSON.stringify(await page.getStructTree());
    for (const id of ids) expect(tree).toContain(`"id":"${id}"`);
    expect(tree).toContain('"role":"Table"');
    expect(tree).toContain('"summary":"Scores by person"');
    expect(tree).toContain('"structId":"hdr-name","scope":"Column"');
    expect(tree).toContain('"colSpan":2,"headers":["hdr-name","hdr-score"]');
    expect(tree).toContain('"alt":"Bar chart showing Ada scoring 10"');
    expect(tree).toContain('{"type":"annotation","id":"pdfjs_internal_id_4R"}');
    expect(content.lang).toBe('en-GB');
    expect(JSON.stringify(await (await pdf.getPage(1)).getStructTree())).toContain('"lang":"fr-FR"');
    expect(await pdf.getPageLabels()).toEqual(['i', 'ii', '1']);
    await task.destroy();
  });

  it('keeps unowned text and returns no struct tree for untagged pages', async () => {
    const { task, pdf } = await open(taggedReport());
    const content = await (await pdf.getPage(2)).getTextContent({ includeMarkedContent: true });
    const strings = content.items.flatMap((item) => ('str' in item ? [item.str] : []));
    expect(strings).toContain('Unowned note printed without tags.');
    await task.destroy();
    const rotated = await open(rotatedPage());
    expect(await (await rotated.pdf.getPage(1)).getStructTree()).toBeNull();
    await rotated.task.destroy();
  });

  it('inserts synthetic whitespace and empty end-of-line items', async () => {
    const { task, pdf } = await open(taggedReport());
    const content = await (await pdf.getPage(2)).getTextContent({ includeMarkedContent: true });
    const textItems = content.items.filter((item): item is TextItem => 'str' in item);
    expect(textItems.some((item) => item.str === '' && item.hasEOL)).toBe(true);
    expect(textItems.some((item) => item.str === ' ' && item.width > 100)).toBe(true);
    await task.destroy();
  });

  it('normalizes ligatures, keeps line-end hyphens, reports rotation separately from text transforms', async () => {
    const { task, pdf } = await open(ligatureAndHyphenation());
    const strings = (await (await pdf.getPage(1)).getTextContent()).items.flatMap((item) =>
      'str' in item ? [item.str] : [],
    );
    expect(strings[0]).toBe('The first flow of efficient work.');
    expect(strings).toContain('Reading improves accessi-');
    expect(strings).toContain('Café crème — naïve résumé.');
    await task.destroy();
    const rotated = await open(rotatedPage());
    const page = await rotated.pdf.getPage(1);
    expect(page.rotate).toBe(90);
    const item = (await page.getTextContent()).items[0] as TextItem;
    expect(item.transform).toEqual([14, 0, 0, 14, 72, 700]);
    const viewport = page.getViewport({ scale: 1 });
    expect([viewport.width, viewport.height]).toEqual([792, 612]);
    await rotated.task.destroy();
  });

  it('returns no text for an image-only page', async () => {
    const { task, pdf } = await open(scannedPage());
    expect((await (await pdf.getPage(1)).getTextContent()).items).toHaveLength(0);
    await task.destroy();
  });

  it('exposes safe link urls, internal destinations and withholds JavaScript and file: actions', async () => {
    const { task, pdf } = await open(linkedDocument());
    const annotations = (await (await pdf.getPage(1)).getAnnotations()) as Array<Record<string, unknown>>;
    expect(annotations[0].dest).toEqual([
      expect.objectContaining({ num: expect.any(Number) }),
      { name: 'XYZ' },
      0,
      792,
      0,
    ]);
    expect(await pdf.getPageIndex((annotations[0].dest as unknown[])[0] as { num: number; gen: number } as never)).toBe(
      1,
    );
    expect(annotations[1].url).toBe('https://example.org/docs');
    expect(annotations[2].url).toBeUndefined();
    expect(annotations[2].action).toBeUndefined();
    expect(annotations[3].url).toBeUndefined();
    expect(annotations[3].unsafeUrl).toBe('file:///etc/passwd');
    await task.destroy();
  });

  it('transfers (detaches) typed-array input, so callers must pass a copy', async () => {
    const bytes = rotatedPage();
    const { task } = await open(bytes);
    expect(bytes.byteLength).toBe(0);
    await task.destroy();
  });

  it('has no PDFDocumentProxy.destroy; the loading task owns teardown', async () => {
    const { task, pdf } = await open(rotatedPage());
    expect((pdf as unknown as { destroy?: unknown }).destroy).toBeUndefined();
    expect(pdf.loadingTask).toBe(task);
    await task.destroy();
  });

  it('reads a real Chrome (Skia/PDF m154) tagged PDF with unsubtyped header/footer artifacts', async () => {
    const data = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'chrome-tagged-sample.pdf')));
    const { task, pdf } = await open(data);
    const page = await pdf.getPage(1);
    const content = await page.getTextContent({ includeMarkedContent: true });
    const tags = content.items.flatMap((item) => ('tag' in item ? [(item as MarkedItem).tag] : []));
    expect(tags.filter((tag) => tag === 'Artifact')).toHaveLength(3);
    expect(tags).toContain('NonStruct');
    const tree = JSON.stringify(await page.getStructTree());
    expect(tree).toContain('"role":"H1"');
    expect(tree).toContain('"role":"Lbl"');
    await task.destroy();
  });
});
