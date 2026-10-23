// @vitest-environment node
/**
 * Phase 7 lifecycle validation against the real pdf.js: a PdfDocument
 * releases its worker-side document on destroy, destroy is safe to call
 * more than once (the reader's cleanup can race a manual close), and
 * destroying a document that never finished loading still resolves.
 */
import { describe, expect, it } from 'vitest';
import { PdfDocument } from '../renderer/pdf-semantic/pdf-document';
import { taggedReport } from './fixtures/pdf-fixtures';

describe('PdfDocument lifecycle', () => {
  it('serves pages before destroy and rejects them after', async () => {
    const document = new PdfDocument(taggedReport(), 'sha256-fixture', 'Reports/tagged.pdf');
    await document.ready;
    const page = await document.getPage(1);
    expect(page.pageNum).toBe(1);
    await document.destroy();
    await expect(document.getPage(1)).rejects.toThrow();
  });

  it('makes destroy idempotent', async () => {
    const document = new PdfDocument(taggedReport(), 'sha256-fixture', 'Reports/tagged.pdf');
    await document.ready;
    await document.destroy();
    await expect(document.destroy()).resolves.toBeUndefined();
  });

  it('destroys a document that never finished loading', async () => {
    const document = new PdfDocument(taggedReport(), 'sha256-fixture', 'Reports/tagged.pdf');
    void document.ready.catch(() => undefined);
    await expect(document.destroy()).resolves.toBeUndefined();
  });
});
