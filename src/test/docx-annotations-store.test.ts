// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAnnotationStore } from '../../electron/vault/annotations';
import { docxAnchorText, resolveDocxAnchor, type NewDocxAnnotation } from '../shared/docx-annotations';
import type { DocxStructure } from '../shared/docx';

const input: NewDocxAnnotation = {
  path: 'Docs/Report.docx',
  anchor: { blockIndex: 2, quote: 'quarterly results', prefix: 'see the ', suffix: ' section', start: 8, end: 25 },
  color: 'yellow',
  label: 'Key figure',
  comment: 'Verify against the spreadsheet.',
};

function fixture(initial?: unknown, resolveEffectivePath?: (path: string) => Promise<string>) {
  let metadata: unknown = initial;
  const read = vi.fn(async () => structuredClone(metadata));
  const write = vi.fn(async (value: unknown) => {
    metadata = structuredClone(value);
  });
  const validateNote = vi.fn(async () => undefined);
  const validatePdf = vi.fn(async () => undefined);
  const validateDocx = vi.fn(async () => undefined);
  const store = createAnnotationStore({
    read,
    write,
    validateNote,
    validatePdf,
    validateDocx,
    resolveEffectivePath,
  });
  return { store, write, validateDocx, snapshot: () => metadata };
}

/**
 * An Alius record resolves to its original for format validation, the
 * way the main process wires resolveEffectivePath to the service's
 * resolveAlius. The annotation itself stays keyed by the record path.
 */
const aliusResolver = async (path: string) =>
  path === 'Docs/Report.docx.alius'
    ? '/outside/Report.docx'
    : path === 'Docs/Report.pdf.alius'
      ? '/outside/Report.pdf'
      : path;

describe('DOCX annotation persistence', () => {
  it('supports CRUD in the shared v3 envelope alongside the other formats', async () => {
    const { store, snapshot } = fixture();
    const added = await store.docx.add(input);
    expect(added.schemaVersion).toBe(1);
    expect(await store.docx.list(input.path)).toEqual([added]);
    expect(snapshot()).toMatchObject({ version: 4, annotations: [], pdfAnnotations: [], docxAnnotations: [added] });
    const updated = await store.docx.update(input.path, added.id, { label: 'Updated' });
    expect(updated.label).toBe('Updated');
    expect(updated.anchor).toEqual(added.anchor);
    await store.docx.delete(input.path, added.id);
    expect(await store.docx.list(input.path)).toEqual([]);
  });

  it('loads v2 envelopes (no DOCX collection) and upgrades them on write', async () => {
    const { store, snapshot } = fixture({ version: 2, annotations: [], pdfAnnotations: [] });
    await store.docx.add(input);
    expect(snapshot()).toMatchObject({ version: 4, docxAnnotations: [expect.objectContaining({ label: 'Key figure' })] });
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

  it('accepts an Alius record path, keyed by the record path', async () => {
    const { store, snapshot } = fixture(undefined, aliusResolver);
    const record = 'Docs/Report.docx.alius';
    expect(await store.docx.list(record)).toEqual([]);
    const added = await store.docx.add({ ...input, path: record });
    expect(added.path).toBe(record);
    expect(await store.docx.list(record)).toEqual([added]);
    expect(snapshot()).toMatchObject({ docxAnnotations: [expect.objectContaining({ path: record })] });
    const updated = await store.docx.update(record, added.id, { label: 'Updated' });
    expect(updated.label).toBe('Updated');
    await store.docx.delete(record, added.id);
    expect(await store.docx.list(record)).toEqual([]);
  });

  it('rejects an Alius record whose original is the wrong format', async () => {
    const { store, write } = fixture(undefined, aliusResolver);
    await expect(store.docx.add({ ...input, path: 'Docs/Report.pdf.alius' })).rejects.toThrow(
      'DOCX annotations require a Word document.',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an Alius record path without a resolver', async () => {
    const { store, write } = fixture();
    await expect(store.docx.list('Docs/Report.docx.alius')).rejects.toThrow(
      'DOCX annotations require a Word document.',
    );
    expect(write).not.toHaveBeenCalled();
  });
});

describe('docxAnchorText', () => {
  const blocks: DocxStructure['blocks'] = [
    { kind: 'paragraph', text: 'Intro', runs: [] },
    {
      kind: 'table',
      rows: [
        { cells: [{ paragraphs: [{ kind: 'paragraph', text: 'A1', runs: [] }] }, { paragraphs: [{ kind: 'paragraph', text: 'B', runs: [] }, { kind: 'paragraph', text: '1', runs: [] }] }] },
      ],
    },
  ];
  const base = { quote: 'x', prefix: '', suffix: '', start: 0, end: 1 };
  it('addresses paragraphs and table cells, and rejects mismatches', () => {
    expect(docxAnchorText(blocks, { ...base, blockIndex: 0 })).toBe('Intro');
    expect(docxAnchorText(blocks, { ...base, blockIndex: 0, cellIndex: 0 })).toBeNull();
    expect(docxAnchorText(blocks, { ...base, blockIndex: 1, cellIndex: 1 })).toBe('B1');
    expect(docxAnchorText(blocks, { ...base, blockIndex: 1 })).toBeNull();
    expect(docxAnchorText(blocks, { ...base, blockIndex: 9 })).toBeNull();
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
