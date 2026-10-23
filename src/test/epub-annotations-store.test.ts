// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAnnotationStore } from '../../electron/vault/annotations';
import { formatEpubAnnotationsExport, type NewEpubAnnotation } from '../shared/epub-annotations';

const input: NewEpubAnnotation = {
  path: 'Books/Novel.epub',
  anchor: {
    cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:12)',
    sectionHref: 'chapter1.xhtml',
    quote: 'a dark night',
    prefix: 'It was ',
    suffix: ' in the city',
  },
  color: 'blue',
  label: 'Opening',
  comment: '',
};

function fixture(initial?: unknown) {
  let metadata: unknown = initial;
  const read = vi.fn(async () => structuredClone(metadata));
  const write = vi.fn(async (value: unknown) => {
    metadata = structuredClone(value);
  });
  const store = createAnnotationStore({
    read,
    write,
    validateNote: vi.fn(async () => undefined),
    validatePdf: vi.fn(async () => undefined),
    validateDocx: vi.fn(async () => undefined),
    validateEpub: vi.fn(async () => undefined),
  });
  return { store, write, snapshot: () => metadata };
}

describe('ePub annotation persistence', () => {
  it('supports CRUD in the shared v4 envelope', async () => {
    const { store, snapshot } = fixture();
    const added = await store.epub.add(input);
    expect(added.schemaVersion).toBe(1);
    expect(await store.epub.list(input.path)).toEqual([added]);
    expect(snapshot()).toMatchObject({ version: 4, epubAnnotations: [added] });
    const updated = await store.epub.update(input.path, added.id, { comment: 'Foreshadowing.' });
    expect(updated.comment).toBe('Foreshadowing.');
    expect(updated.anchor).toEqual(added.anchor);
    await store.epub.delete(input.path, added.id);
    expect(await store.epub.list(input.path)).toEqual([]);
  });

  it('loads v3 envelopes and upgrades them on write', async () => {
    const { store, snapshot } = fixture({ version: 3, annotations: [], pdfAnnotations: [], docxAnnotations: [] });
    await store.epub.add(input);
    expect(snapshot()).toMatchObject({ version: 4, epubAnnotations: [expect.objectContaining({ label: 'Opening' })] });
  });

  it('rejects unsafe paths, wrong extensions, and malformed CFIs before writing', async () => {
    const { store, write } = fixture();
    await expect(store.epub.add({ ...input, path: '../Novel.epub' })).rejects.toThrow();
    await expect(store.epub.add({ ...input, path: '.a11ynotebook/Novel.epub' })).rejects.toThrow();
    await expect(store.epub.add({ ...input, path: 'Books/Novel.pdf' })).rejects.toThrow();
    await expect(store.epub.add({ ...input, anchor: { ...input.anchor, cfiRange: 'not-a-cfi' } })).rejects.toThrow();
    await expect(store.epub.add({ ...input, anchor: { ...input.anchor, quote: '' } })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('migrates ePub annotation paths when the book moves', async () => {
    const { store } = fixture();
    const added = await store.epub.add(input);
    await store.migratePaths('Books/Novel.epub', 'Archive/Novel.epub');
    expect(await store.epub.list('Archive/Novel.epub')).toEqual([{ ...added, path: 'Archive/Novel.epub' }]);
  });

  it('exports original quotes with status lines', () => {
    const annotation = { ...input, id: 'a', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', schemaVersion: 1 as const };
    const output = formatEpubAnnotationsExport('Books/Novel.epub', [{ annotation, status: 'orphan' }]);
    expect(output).toContain('Annotations for Novel.epub');
    expect(output).toContain('## Opening (blue highlight) — chapter1.xhtml');
    expect(output).toContain('> a dark night');
    expect(output).toContain('Status: Highlight unavailable');
  });
});
