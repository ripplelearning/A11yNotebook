// @vitest-environment node
import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it, vi } from 'vitest';
import type { PdfAnnotationTarget, PdfDocumentIdentity } from '../shared/pdf-annotation';
import { PdfDocument, PdfPage } from '../renderer/pdf-semantic/pdf-document';
import { TextModel } from '../renderer/pdf-semantic/text-model';
import { rotatedPage, taggedReport } from './fixtures/pdf-fixtures';

const identity: PdfDocumentIdentity = {
  fingerprint: 'fingerprint',
  fileHash: 'hash',
  vaultPath: 'Reports/report.pdf',
};

function item(str: string): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [12, 0, 0, 12, 10, 200],
    width: str.length * 6,
    height: 12,
    fontName: 'fixture',
    hasEOL: false,
  };
}

function model(text: string, page = 1, documentIdentity = identity): TextModel {
  return new TextModel([item(text)], new Map(), [0, 0, 300, 400], page, documentIdentity);
}

function documentFixture(texts: string[]) {
  const getPage = vi.fn(async (page: number) => ({
    resolveAnnotationAnchor: (target: PdfAnnotationTarget) => model(texts[page - 1], page).resolveAnchor(target),
  }));
  const document = Object.assign(Object.create(PdfDocument.prototype) as PdfDocument, {
    fileHash: identity.fileHash,
    vaultPath: identity.vaultPath,
    numPages: texts.length,
    getPage,
  });
  Object.defineProperty(document, 'ready', { value: Promise.resolve() });
  return { document, getPage };
}

describe('stable PDF annotation anchors', () => {
  it('requires identity and valid canonical ranges without changing the original text', () => {
    expect(() => new TextModel([item('quote')]).createAnchor(1, 0, 5)).toThrow(/identity/);
    const text = model('before ﬁle after', 3);
    const anchor = text.createAnchor(3, 7, 3);
    expect(anchor).toEqual({
      kind: 'pdf',
      documentIdentity: identity,
      page: 3,
      canonicalStart: 7,
      canonicalLength: 3,
      exactQuote: 'ﬁle',
      normalizedQuote: 'file',
      contextBefore: 'before',
      contextAfter: 'after',
      classification: 'exact',
      confidence: 'certain',
      verification: 'verified',
    });
    anchor.documentIdentity.fileHash = 'mutation';
    expect(text.documentIdentity).toEqual(identity);
    for (const [page, start, length] of [
      [2, 0, 1],
      [3, -1, 1],
      [3, 0, 0],
      [3, 0.5, 1],
      [3, 0, 100],
    ]) {
      expect(() => text.createAnchor(page, start, length)).toThrow(RangeError);
    }
  });

  it('relocates only unique exact quotes and disambiguates repeated quotes using context', () => {
    const anchor = model('before quote after').createAnchor(1, 7, 5);
    expect(model('new intro before quote after').resolveAnchor(anchor)).toMatchObject({
      offset: 17,
      page: 1,
      length: 5,
      classification: 'exact',
      confidence: 'certain',
      verification: 'verified',
    });

    expect(model('wrong quote ending. before quote after').resolveAnchor(anchor)).toMatchObject({
      offset: 27,
      classification: 'context-disambiguated',
      confidence: 'certain',
    });
    const staleOffset = model('wrong! quote end before quote after');
    expect(staleOffset.fullText.slice(anchor.canonicalStart, anchor.canonicalStart + anchor.canonicalLength)).toBe(
      'quote',
    );
    expect(staleOffset.resolveAnchor(anchor)).toMatchObject({
      offset: staleOffset.fullText.lastIndexOf('quote'),
      classification: 'context-disambiguated',
      confidence: 'certain',
    });
    const repeated = { ...anchor, contextBefore: '', contextAfter: '', canonicalStart: 0 };
    expect(model('quote quote').resolveAnchor(repeated)).toMatchObject({
      offset: -1,
      classification: 'ambiguous',
      confidence: 'uncertain',
    });
    expect(model('quote quote').resolveAnchor(repeated)).not.toHaveProperty('length');
  });

  it('classifies newly created repeated quotes without losing the selected canonical range', () => {
    const contextual = model('before quote after. different quote ending');
    expect(contextual.createAnchor(1, 7, 5)).toMatchObject({
      canonicalStart: 7,
      canonicalLength: 5,
      classification: 'context-disambiguated',
      confidence: 'certain',
    });
    const repeatedBlock = `${'x'.repeat(80)}quote${'y'.repeat(80)}`;
    const ambiguous = model(`${repeatedBlock} separator ${repeatedBlock}`);
    expect(ambiguous.createAnchor(1, 80, 5)).toMatchObject({
      canonicalStart: 80,
      canonicalLength: 5,
      classification: 'ambiguous',
      confidence: 'uncertain',
      reason: expect.stringContaining('Multiple'),
    });
  });

  it('prioritizes exact duplicate context over normalized variants', () => {
    const anchor = model('before FILE after').createAnchor(1, 7, 4);
    const text = model('wrong FILE ending before FILE after. before file after');
    expect(text.resolveAnchor(anchor)).toMatchObject({
      offset: 25,
      length: 4,
      classification: 'context-disambiguated',
      confidence: 'certain',
    });
  });

  it('maps normalized Unicode expansions, combining sequences and surrogate pairs back to canonical ranges', () => {
    const anchor = model('😀 file café SOFTWARE').createAnchor(1, 3, 18);
    const current = model('😀 ﬁle cafe\u0301 soft\u00adware');
    const resolution = current.resolveAnchor(anchor);
    expect(resolution).toMatchObject({
      offset: 3,
      page: 1,
      length: current.fullText.length - 3,
      classification: 'normalized',
      confidence: 'probable',
    });
    expect(current.findText('file')[0]).toEqual({ startOffset: 3, length: 3, page: 1 });
    expect(current.findText('café')[0]).toEqual({ startOffset: 7, length: 5, page: 1 });
    expect(current.findText('😀 file')[0]).toEqual({ startOffset: 0, length: 6, page: 1 });
    expect(model('İ tail').findText('tail')[0]).toEqual({ startOffset: 2, length: 4, page: 1 });
    expect(model('hello\u00a0 \nworld').resolveAnchor(model('HELLO world').createAnchor(1, 0, 11))).toMatchObject({
      offset: 0,
      length: 13,
      classification: 'normalized',
    });
  });

  it('retains ambiguity for normalized repeated quotes and disambiguates with normalized context', () => {
    const anchor = model('before file after').createAnchor(1, 7, 4);
    expect(model('other ﬁle ending before ﬁle after').resolveAnchor(anchor)).toMatchObject({
      offset: 24,
      length: 3,
      classification: 'normalized',
    });
    expect(model('ﬁle ﬁle').resolveAnchor({ ...anchor, contextBefore: '', contextAfter: '' })).toMatchObject({
      offset: -1,
      classification: 'ambiguous',
      confidence: 'uncertain',
    });
  });

  it('marks hash changes and persisted unverified targets for explicit manual reconfirmation', () => {
    const anchor = model('quote').createAnchor(1, 0, 5);
    const changed = model('quote', 1, { ...identity, fileHash: 'changed-hash' });
    expect(changed.resolveAnchor(anchor)).toMatchObject({
      offset: 0,
      verification: 'unverified',
      confidence: 'probable',
      reason: expect.stringContaining('manual reconfirmation'),
    });
    expect(model('quote').resolveAnchor({ ...anchor, verification: 'unverified' })).toMatchObject({
      verification: 'unverified',
    });
    expect(changed.resolveAnchor(changed.createAnchor(1, 0, 5))).toMatchObject({ verification: 'verified' });
    expect(model('quote', 1, { ...identity, vaultPath: 'Other.pdf' }).resolveAnchor(anchor)).toMatchObject({
      orphaned: true,
      classification: 'orphan',
      confidence: 'uncertain',
      reason: expect.stringContaining('vault path'),
    });
  });

  it('returns explicit orphan results for absent, empty-normalized and malformed targets without throwing', () => {
    const anchor = model('quote').createAnchor(1, 0, 5);
    expect(model('gone').resolveAnchor(anchor)).toMatchObject({
      orphaned: true,
      classification: 'orphan',
      confidence: 'uncertain',
    });
    expect(model('text').resolveAnchor(model('\u00ad').createAnchor(1, 0, 1))).toMatchObject({ orphaned: true });
    for (const target of [
      null,
      {},
      { ...anchor, page: NaN },
      { ...anchor, canonicalStart: -1 },
      { ...anchor, canonicalLength: 0 },
      { ...anchor, exactQuote: 4 },
      { ...anchor, documentIdentity: null },
      { ...anchor, normalizedQuote: 'different text' },
      { ...anchor, structPath: {} },
      { ...anchor, reason: [] },
    ]) {
      expect(model('quote').resolveAnchor(target as PdfAnnotationTarget)).toMatchObject({
        orphaned: true,
        reason: expect.stringContaining('Malformed'),
      });
    }
  });

  it('does not promote malformed stored targets until the user explicitly creates a new anchor', async () => {
    const text = model('quote');
    const captured = text.createAnchor(1, 0, 5);
    for (const reason of [
      'Stored PDF target was malformed; select text again to re-anchor.',
      'Stored grouped PDF target was malformed; select text again to re-anchor.',
    ]) {
      const corrupted: PdfAnnotationTarget = {
        ...captured,
        classification: 'orphan',
        confidence: 'uncertain',
        verification: 'unverified',
        reason,
      };
      expect(text.resolveAnchor(corrupted)).toEqual({
        orphaned: true,
        classification: 'orphan',
        confidence: 'uncertain',
        verification: 'unverified',
        reason,
      });
      const document = documentFixture(['quote']);
      expect(await document.document.resolveAnnotationAnchor(corrupted)).toMatchObject({
        orphaned: true,
        verification: 'unverified',
        reason,
      });
      expect(document.getPage).not.toHaveBeenCalled();
    }
    expect(text.resolveAnchor(text.createAnchor(1, 0, 5))).toMatchObject({
      classification: 'exact',
      verification: 'verified',
    });
  });

  it('exposes page identity and anchors independent of zoom and rotation', async () => {
    const source = {
      rotate: 90,
      view: [0, 0, 300, 400],
      getTextContent: async () => ({ items: [item('before quote after')] }),
      getStructTree: async () => null,
      getAnnotations: async () => [],
    } as unknown as PDFPageProxy;
    const page = await PdfPage.create(source, 2, undefined, undefined, identity);
    const anchor = page.createAnnotationAnchor(7, 5);
    expect(page.documentIdentity).toEqual(identity);
    expect(page.highlightAtAnchor(7, 5, 1, 0)).not.toEqual(page.highlightAtAnchor(7, 5, 2, 90));
    expect(page.createAnnotationAnchor(7, 5)).toEqual(anchor);
    expect(page.resolveAnnotationAnchor(anchor)).toMatchObject({
      offset: 7,
      page: 2,
      length: 5,
      classification: 'exact',
    });
  });

  it('resolves the original page first and does not search nearby when it is ambiguous', async () => {
    const anchor = { ...model('quote', 3).createAnchor(3, 0, 5), contextBefore: '', contextAfter: '' };
    const exact = documentFixture(['quote', 'quote', 'quote', 'quote', 'quote']);
    expect(await exact.document.resolveAnnotationAnchor(anchor)).toMatchObject({
      page: 3,
      offset: 0,
      classification: 'exact',
    });
    expect(exact.getPage.mock.calls).toEqual([[3]]);
    const ambiguous = documentFixture(['quote', 'gone', 'quote quote', 'gone', 'gone']);
    expect(await ambiguous.document.resolveAnnotationAnchor(anchor)).toMatchObject({
      page: 3,
      offset: -1,
      classification: 'ambiguous',
    });
    expect(ambiguous.getPage.mock.calls).toEqual([[3]]);
  });

  it('searches at most two nearby pages and never chooses an arbitrary nearest match', async () => {
    const anchor = model('quote', 4).createAnchor(4, 0, 5);
    const nearby = documentFixture(['quote', 'gone', 'gone', 'gone', 'prefix quote', 'gone', 'quote']);
    expect(await nearby.document.resolveAnnotationAnchor(anchor)).toMatchObject({
      page: 5,
      offset: 7,
      classification: 'exact',
      reason: expect.stringContaining('nearby page 5'),
    });
    expect(nearby.getPage.mock.calls).toEqual([[4], [2], [3], [5], [6]]);
    const repeated = documentFixture(['gone', 'quote', 'gone', 'gone', 'quote', 'gone']);
    expect(await repeated.document.resolveAnnotationAnchor(anchor)).toMatchObject({
      offset: -1,
      classification: 'ambiguous',
      confidence: 'uncertain',
    });
    const gone = documentFixture(['quote', 'gone', 'gone', 'gone', 'gone', 'gone', 'quote']);
    expect(await gone.document.resolveAnnotationAnchor(anchor)).toMatchObject({
      orphaned: true,
      reason: expect.stringContaining('within two nearby pages'),
    });
  });

  it('handles shortened documents, scanned pages and malformed document targets', async () => {
    const anchor = model('quote', 3).createAnchor(3, 0, 5);
    const shortened = documentFixture(['quote']);
    expect(await shortened.document.resolveAnnotationAnchor(anchor)).toMatchObject({ page: 1, offset: 0 });
    const scanned = documentFixture(['']);
    expect(await scanned.document.resolveAnnotationAnchor(anchor)).toMatchObject({ orphaned: true });
    expect(await scanned.document.resolveAnnotationAnchor(null as unknown as PdfAnnotationTarget)).toMatchObject({
      orphaned: true,
      reason: expect.stringContaining('Malformed'),
    });
  });

  it('rejects another document vault path before searching its pages', async () => {
    const anchor = model('quote').createAnchor(1, 0, 5);
    const other = documentFixture(['quote']);
    expect(
      await other.document.resolveAnnotationAnchor({
        ...anchor,
        documentIdentity: { ...identity, vaultPath: 'Other.pdf' },
      }),
    ).toMatchObject({
      orphaned: true,
      classification: 'orphan',
      reason: expect.stringContaining('vault path'),
    });
    expect(other.getPage).not.toHaveBeenCalled();
  });

  it('supplies actual loaded document identity to pages and resolves native rotated PDFs', async () => {
    for (const bytes of [taggedReport(), rotatedPage()]) {
      const document = new PdfDocument(bytes, 'fixture-hash', 'Reports/fixture.pdf');
      try {
        const page = await document.getPage(1);
        const anchor = page.createAnnotationAnchor(0, page.textModel.fullText.length);
        expect(anchor.documentIdentity).toEqual(document.documentIdentity);
        expect(anchor.documentIdentity.fingerprint).toMatch(/^[\da-f]+$/);
        expect(await document.resolveAnnotationAnchor(anchor)).toMatchObject({
          page: 1,
          offset: 0,
          length: page.textModel.fullText.length,
          classification: 'exact',
          verification: 'verified',
        });
      } finally {
        await document.destroy();
      }
    }
  });
});
