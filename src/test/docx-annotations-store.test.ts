// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAnnotationStore } from '../../electron/vault/annotations';
import { resolveDocxAnchor, type NewDocxAnnotation } from '../shared/docx-annotations';

const input: NewDocxAnnotation = {
  path: 'Docs/Report.docx',
  anchor: { blockIndex: 2, quote: 'quarterly results', prefix: 'see the ', suffix: ' section', start: 8, end: 25 },
  color: 'yellow',
  label: 'Key figure',
  comment: 'Verify against the spreadsheet.',
};

function fixture(initial?: unknown) {
  let metadata: unknown = initial;
  const read = vi.fn(async () => structuredClone(metadata));
  const write = vi.fn(async (value: unknown) => {
    metadata = structuredClone(value);
  });
  const validateNote = vi.fn(async () => undefined);
  const validatePdf = vi.fn(async () => undefined);
  const validateDocx = vi.fn(async () => undefined);
  const store = createAnnotationStore({ read, write, validateNote, validatePdf, validateDocx });
  return { store, write, validateDocx, snapshot: () => metadata };
}

describe('DOCX annotation persistence', () => {
  it('supports CRUD in the shared v3 envelope alongside the other formats', async () => {
    const { store, snapshot } = fixture();
    const added = await store.docx.add(input);
    expect(added.schemaVersion).toBe(1);
    expect(await store.docx.list(input.path)).toEqual([added]);
    expect(snapshot()).toMatchObject({ version: 3, annotations: [], pdfAnnotations: [], docxAnnotations: [added] });
    const updated = await store.docx.update(input.path, added.id, { label: 'Updated' });
    expect(updated.label).toBe('Updated');
    expect(updated.anchor).toEqual(added.anchor);
    await store.docx.delete(input.path, added.id);
    expect(await store.docx.list(input.path)).toEqual([]);
  });

  it('loads v2 envelopes (no DOCX collection) and upgrades them on write', async () => {
    const { store, snapshot } = fixture({ version: 2, annotations: [], pdfAnnotations: [] });
    await store.docx.add(input);
    expect(snapshot()).toMatchObject({ version: 3, docxAnnotations: [expect.objectContaining({ label: 'Key figure' })] });
  });

  it('rejects unsafe paths, wrong extensions, and malformed anchors before writing', async () => {
    const { store, write } = fixture();
    await expect(store.docx.add({ ...input, path: '../Report.docx' })).rejects.toThrow();
    await expect(store.docx.add({ ...input, path: '.a11ynotebook/Report.docx' })).rejects.toThrow();
    await expect(store.docx.add({ ...input, path: 'Docs/Report.pdf' })).rejects.toThrow();
    await expect(store.docx.add({ ...input, anchor: { ...input.anchor, end: 99 } })).rejects.toThrow();
    await expect(store.docx.add({ ...input, anchor: { ...input.anchor, blockIndex: -1 } })).rejects.toThrow();
    await expect(store.docx.add({ ...input, color: 'red' as never })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('migrates DOCX annotation paths when the document moves', async () => {
    const { store } = fixture();
    const added = await store.docx.add(input);
    await store.migratePaths('Docs/Report.docx', 'Archive/Report.docx');
    expect(await store.docx.list('Archive/Report.docx')).toEqual([{ ...added, path: 'Archive/Report.docx' }]);
  });
});

describe('resolveDocxAnchor', () => {
  const anchor = { blockIndex: 0, quote: 'results', prefix: 'the ', suffix: ' are', start: 4, end: 11 };

  it('prefers the recorded offsets when they still match', () => {
    expect(resolveDocxAnchor('the results are in', anchor)).toEqual({ start: 4, end: 11, status: 'anchored' });
  });

  it('re-anchors a unique quote after the block text shifts', () => {
    expect(resolveDocxAnchor('all the results are in', anchor)).toEqual({ start: 8, end: 15, status: 'anchored' });
  });

  it('uses context to disambiguate repeats, and reports ambiguity and orphans', () => {
    expect(resolveDocxAnchor('results and the results are final', anchor).status).toBe('anchored');
    expect(resolveDocxAnchor('results results', { ...anchor, prefix: '', suffix: '' }).status).toBe('ambiguous');
    expect(resolveDocxAnchor('nothing here', anchor).status).toBe('orphan');
  });
});
