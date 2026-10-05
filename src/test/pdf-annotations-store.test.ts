// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnnotationStore } from '../../electron/vault/annotations';
import { createVaultService } from '../../electron/vault/service';
import {
  PDF_ANNOTATION_SCHEMA_VERSION,
  type NewPdfAnnotation,
  type PdfAnnotationTarget,
} from '../shared/pdf-annotation';
import { NOTE_ANNOTATION_SCHEMA_VERSION, type NewAnnotation } from '../shared/annotations';
import { ANNOTATION_SCHEMA_VERSIONS, type AnnotationRecord } from '../shared/annotation-store';
import { untaggedReport } from './fixtures/pdf-fixtures';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', { spy: true });

const target: PdfAnnotationTarget = {
  kind: 'pdf',
  documentIdentity: { fingerprint: 'pdf-fingerprint', fileHash: 'sha256', vaultPath: 'Docs/Research.pdf' },
  page: 1,
  canonicalStart: 5,
  canonicalLength: 5,
  exactQuote: 'words',
  normalizedQuote: 'words',
  contextBefore: 'some ',
  contextAfter: ' after',
  classification: 'exact',
  confidence: 'certain',
  verification: 'verified',
  manuallyConfirmed: false,
};
const input: NewPdfAnnotation = {
  path: 'Docs/Research.pdf',
  target,
  color: 'yellow',
  label: '',
  comment: 'Remember this',
};
const note: NewAnnotation = {
  path: 'Idea.md',
  anchor: { quote: 'words', prefix: '', suffix: '', start: 0, end: 5 },
  color: 'pink',
  label: 'Note highlight',
  comment: '',
};

function fixture(initial?: unknown) {
  let metadata: unknown = initial;
  const read = vi.fn(async () => structuredClone(metadata));
  const write = vi.fn(async (value: unknown) => {
    metadata = structuredClone(value);
  });
  const validateNote = vi.fn(async () => undefined);
  const validatePdf = vi.fn(async () => undefined);
  const options = { read, write, validateNote, validatePdf };
  return { store: createAnnotationStore(options), options, write, validatePdf, snapshot: () => metadata };
}

describe('PDF annotation persistence', () => {
  it('persists, reloads, updates fields and targets, groups pages, and deletes', async () => {
    const { store, options } = fixture();
    const extra = { ...target, page: 2 };
    const added = await store.pdf.add({ ...input, targets: [extra] });
    expect(added).toMatchObject({ schemaVersion: 1, target, targets: [extra], color: 'yellow' });
    expect(added.id).toMatch(/^[\da-f-]{36}$/);
    const reloaded = createAnnotationStore(options);
    expect(await reloaded.pdf.list(input.path)).toEqual([added]);
    const updated = await reloaded.pdf.update(input.path, added.id, { color: 'none', label: 'Reviewed', comment: '' });
    expect(updated.target).toEqual(target);
    expect(updated.targets).toEqual([extra]);
    expect(updated.createdAt).toBe(added.createdAt);
    expect(updated.modifiedAt).toBeTruthy();
    const reanchored = await reloaded.pdf.update(input.path, added.id, { target: { ...target, page: 3 }, targets: [] });
    expect(reanchored.target.page).toBe(3);
    expect(reanchored.targets).toEqual([]);
    await reloaded.pdf.delete(input.path, added.id);
    expect(await store.pdf.list(input.path)).toEqual([]);
  });

  it('persists an explicitly chosen duplicated occurrence and its hash without guessing another location', async () => {
    const { store, options } = fixture();
    const repeated = {
      ...target,
      contextBefore: 'x'.repeat(80),
      contextAfter: 'y'.repeat(80),
      canonicalStart: 200,
      classification: 'ambiguous' as const,
      confidence: 'uncertain' as const,
      verification: 'unverified' as const,
    };
    const added = await store.pdf.add({ ...input, target: repeated });
    const confirmed = {
      ...repeated,
      canonicalStart: 500,
      classification: 'exact' as const,
      confidence: 'certain' as const,
      verification: 'verified' as const,
      manuallyConfirmed: true,
    };
    await store.pdf.update(input.path, added.id, { target: confirmed });
    const reloaded = createAnnotationStore(options);
    expect((await reloaded.pdf.list(input.path))[0].target).toEqual(confirmed);
    await reloaded.pdf.update(input.path, added.id, { comment: 'Chosen second occurrence' });
    expect((await store.pdf.list(input.path))[0].target).toEqual(confirmed);
    const changed = {
      ...confirmed,
      documentIdentity: { ...confirmed.documentIdentity, fileHash: 'changed-document-hash' },
      verification: 'unverified' as const,
      manuallyConfirmed: false,
    };
    await reloaded.pdf.update(input.path, added.id, { target: changed });
    expect((await store.pdf.list(input.path))[0].target).toEqual(changed);
  });

  it('upgrades v1 envelopes without changing note records and serializes both formats', async () => {
    const original = await fixture().store.add(note);
    const { store, snapshot } = fixture({ version: 1, annotations: [original] });
    await Promise.all([store.pdf.add(input), store.add(note), store.pdf.add(input)]);
    expect(await store.list(note.path)).toEqual([original, expect.objectContaining(note)]);
    expect(await store.pdf.list(input.path)).toHaveLength(2);
    expect(snapshot()).toMatchObject({ version: 2, annotations: [original, expect.anything()] });
    expect(original).not.toHaveProperty('schemaVersion');
    const records: AnnotationRecord[] = [original, ...(await store.pdf.list(input.path))];
    expect(records).toHaveLength(3);
    expect([NOTE_ANNOTATION_SCHEMA_VERSION, PDF_ANNOTATION_SCHEMA_VERSION]).toEqual([1, 1]);
    expect(ANNOTATION_SCHEMA_VERSIONS).toEqual({ pdf: 1, markdown: 1, html: 1 });
  });

  it('rejects unsafe paths, bad PDF extensions, malformed offsets and identities before writing', async () => {
    const { store, write, validatePdf } = fixture();
    const invalid = [
      { ...input, path: '../Research.pdf' },
      { ...input, path: '/Research.pdf' },
      { ...input, path: 'C:\\Research.pdf' },
      { ...input, path: '.a11ynotebook/Research.pdf' },
      { ...input, path: 'Docs/Research.md' },
      { ...input, color: 'pink' },
      { ...input, target: { ...target, kind: 'note' } },
      { ...input, target: { ...target, page: 0 } },
      { ...input, target: { ...target, page: 1.5 } },
      { ...input, target: { ...target, canonicalStart: -1 } },
      { ...input, target: { ...target, canonicalLength: 0 } },
      { ...input, target: { ...target, canonicalStart: Number.MAX_SAFE_INTEGER } },
      { ...input, target: { ...target, exactQuote: '' } },
      { ...input, target: { ...target, confidence: 'maybe' } },
      { ...input, target: { ...target, classification: undefined } },
      { ...input, target: { ...target, confidence: undefined } },
      { ...input, target: { ...target, classification: ['exact'] } },
      { ...input, target: { ...target, confidence: ['certain'] } },
      { ...input, target: { ...target, verification: ['verified'] } },
      { ...input, target: { ...target, manuallyConfirmed: 'true' } },
      { ...input, target: { ...target, documentIdentity: { ...target.documentIdentity, vaultPath: 'Other.pdf' } } },
      { ...input, targets: [{ ...target, documentIdentity: { ...target.documentIdentity, vaultPath: 'Other.pdf' } }] },
      { ...input, comment: 'x'.repeat(10_001) },
    ];
    for (const value of invalid) await expect(store.pdf.add(value as NewPdfAnnotation)).rejects.toThrow();
    validatePdf.mockRejectedValueOnce(new Error('Symlink rejected'));
    await expect(store.pdf.add(input)).rejects.toThrow('Symlink rejected');
    expect(write).not.toHaveBeenCalled();
    await expect(store.pdf.add(input)).resolves.toMatchObject(input);
  });

  it('preserves malformed loaded targets as uncertain orphans rather than guessing a match', async () => {
    const added = await fixture().store.pdf.add({ ...input, targets: [{ ...target, page: 2 }] });
    const corruptTarget = { ...target, page: -8, canonicalStart: 'bad', classification: 'guess' };
    const { store } = fixture({
      version: 2,
      annotations: [],
      pdfAnnotations: [{ ...added, target: corruptTarget, targets: [null] }],
    });
    const [loaded] = await store.pdf.list(input.path);
    expect(loaded.target).toMatchObject({
      classification: 'orphan',
      confidence: 'uncertain',
      verification: 'unverified',
      exactQuote: target.exactQuote,
      contextBefore: target.contextBefore,
      contextAfter: target.contextAfter,
    });
    expect(loaded.targets?.[0].classification).toBe('orphan');
    await store.pdf.update(input.path, added.id, { comment: 'Still available for review' });
    const [reloaded] = await store.pdf.list(input.path);
    expect(reloaded.target.classification).toBe('orphan');
    expect(reloaded.target.reason).toBe(loaded.target.reason);
  });

  it('infers absent legacy classification and confidence only for structurally valid targets', async () => {
    const added = await fixture().store.pdf.add(input);
    const legacyTarget: Partial<PdfAnnotationTarget> = { ...target };
    delete legacyTarget.classification;
    delete legacyTarget.confidence;
    delete legacyTarget.manuallyConfirmed;
    const { store } = fixture({
      version: 2,
      annotations: [],
      pdfAnnotations: [{ ...added, target: legacyTarget, targets: [legacyTarget] }],
    });
    const [loaded] = await store.pdf.list(input.path);
    expect(loaded.target).toMatchObject({
      classification: 'exact',
      confidence: 'probable',
      verification: 'unverified',
      exactQuote: target.exactQuote,
      canonicalStart: target.canonicalStart,
      manuallyConfirmed: false,
    });
    expect(loaded.targets?.[0]).toMatchObject({ classification: 'exact', verification: 'unverified' });
    for (const malformed of [
      { ...legacyTarget, page: 0 },
      { ...legacyTarget, classification: null },
      { ...target, manuallyConfirmed: 'true' },
    ]) {
      const { store: malformedStore } = fixture({
        version: 2,
        annotations: [],
        pdfAnnotations: [{ ...added, target: malformed }],
      });
      expect((await malformedStore.pdf.list(input.path))[0].target).toMatchObject({
        classification: 'orphan',
        confidence: 'uncertain',
        verification: 'unverified',
        manuallyConfirmed: false,
      });
    }
  });

  it('rejects corrupt envelopes, duplicate IDs, and edits scoped to a different document', async () => {
    const added = await fixture().store.pdf.add(input);
    for (const initial of [
      { version: 3, annotations: [], pdfAnnotations: [] },
      { version: 2, annotations: [], pdfAnnotations: [added, added] },
      { version: 2, annotations: [], pdfAnnotations: [{ ...added, schemaVersion: 2 }] },
    ]) {
      const { store, write } = fixture(initial);
      await expect(store.pdf.add(input)).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
    }
    const { store } = fixture();
    const item = await store.pdf.add(input);
    await expect(store.pdf.update('Other.pdf', item.id, { comment: 'bad' })).rejects.toThrow('not found');
    await expect(store.pdf.delete('Other.pdf', item.id)).rejects.toThrow('not found');
    await expect(store.pdf.update(input.path, item.id, { path: 'Other.pdf' } as never)).rejects.toThrow();
    await expect(store.pdf.update(input.path, item.id, { target: { ...target, page: 0 } })).rejects.toThrow();
    expect(await store.pdf.list(input.path)).toEqual([item]);
  });

  it('migrates PDF and grouped target identities on exact path boundaries', async () => {
    const { store, validatePdf } = fixture();
    const added = await store.pdf.add({ ...input, targets: [{ ...target, page: 2 }] });
    await store.migratePaths('Docs', 'Archive');
    const [moved] = await store.pdf.list('Archive/Research.pdf');
    expect(moved.id).toBe(added.id);
    expect(moved.target.documentIdentity.vaultPath).toBe(moved.path);
    expect(moved.targets?.[0].documentIdentity.vaultPath).toBe(moved.path);
    expect(validatePdf).toHaveBeenCalledWith('Archive/Research.pdf');
    await store.migratePaths('Doc', 'Wrong');
    expect(await store.pdf.list(moved.path)).toHaveLength(1);
  });
});

const folders: string[] = [];
const services: ReturnType<typeof createVaultService>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe('annotation document security validation', () => {
  it('rejects symlinks, directories, protected content and non-PDF bytes', async () => {
    const root = path.resolve(`.pdf-annotation-test-${randomUUID()}`);
    folders.push(root);
    await mkdir(root);
    await mkdir(path.join(root, 'Folder'));
    await mkdir(path.join(root, 'Directory.pdf'));
    await writeFile(path.join(root, 'Research.pdf'), untaggedReport(1));
    await writeFile(path.join(root, 'Idea.md'), 'safe text');
    await writeFile(path.join(root, 'Protected.md'), JSON.stringify({ format: 'a11ynotebook-password-note-v1' }));
    await writeFile(path.join(root, 'Protected.pdf'), JSON.stringify({ format: 'a11ynotebook-password-note-v1' }));
    await writeFile(path.join(root, 'Fake.pdf'), 'not a PDF');
    await symlink(path.join(root, 'Research.pdf'), path.join(root, 'Linked.pdf'));
    await symlink(path.join(root, 'Folder'), path.join(root, 'LinkedFolder'));
    const service = createVaultService(root);
    services.push(service);
    await service.initialize();
    await expect(service.validatePdfAnnotationDocument('Research.pdf')).resolves.toBeUndefined();
    for (const file of [
      'Linked.pdf',
      'LinkedFolder/File.pdf',
      'Directory.pdf',
      'Protected.pdf',
      'Protected.md',
      'Fake.pdf',
    ])
      await expect(service.validatePdfAnnotationDocument(file)).rejects.toThrow();
    const { options, write } = fixture();
    const store = createAnnotationStore({ ...options, validatePdf: service.validatePdfAnnotationDocument });
    await expect(store.pdf.add({ ...input, path: 'Linked.pdf' })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const destroy = vi.fn(async () => undefined);
    const parser = vi.mocked(pdfjs.getDocument);
    try {
      parser.mockReturnValueOnce({
        promise: Promise.resolve({ getPermissions: async () => [4] }),
        destroy,
      } as unknown as ReturnType<typeof pdfjs.getDocument>);
      await expect(service.validatePdfAnnotationDocument('Research.pdf')).rejects.toThrow('protected content');
      parser.mockImplementationOnce(
        () =>
          ({
            promise: Promise.reject(Object.assign(new Error('Password required'), { name: 'PasswordException' })),
            destroy,
          }) as unknown as ReturnType<typeof pdfjs.getDocument>,
      );
      await expect(service.validatePdfAnnotationDocument('Research.pdf')).rejects.toThrow('protected content');
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      parser.mockRestore();
    }
  });
});
