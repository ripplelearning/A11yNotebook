// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAnnotationStore } from '../../electron/vault/annotations';
import type { NewAnnotation } from '../shared/annotations';

const input: NewAnnotation = {
  path: 'Notes/Idea.md', color: 'green', label: 'Important', comment: 'Remember this',
  anchor: { quote: 'words', prefix: '', suffix: ' after', start: 0, end: 5 },
};

function fixture(initial?: unknown) {
  let metadata: unknown = initial;
  const read = vi.fn(async () => structuredClone(metadata));
  const write = vi.fn(async (value: unknown) => { metadata = structuredClone(value); });
  const validateNote = vi.fn(async () => undefined);
  return { store: createAnnotationStore({ read, write, validateNote }), read, write, validateNote };
}

describe('annotation persistence', () => {
  it('persists main-process IDs, lists, edits, deletes, and reloads records', async () => {
    const { store, read, write, validateNote } = fixture();
    const added = await store.add(input);
    expect(added.id).toMatch(/^[\da-f-]{36}$/);
    const reloaded = createAnnotationStore({ read, write, validateNote });
    expect(await reloaded.list(input.path)).toEqual([added]);
    const updated = await reloaded.update(input.path, added.id, { color: 'pink', label: 'Reviewed', comment: '' });
    expect(updated).toMatchObject({ color: 'pink', label: 'Reviewed', comment: '' });
    expect(updated.anchor).toEqual(input.anchor);
    await reloaded.delete(input.path, added.id);
    expect(await store.list(input.path)).toEqual([]);
  });

  it('serializes concurrent additions and recovers after rejected input', async () => {
    const { store } = fixture();
    await expect(store.add({ ...input, path: '../escape.md' })).rejects.toThrow();
    await Promise.all([store.add(input), store.add(input)]);
    expect(await store.list(input.path)).toHaveLength(2);
  });

  it('rejects malformed data, oversize fields, unsafe paths, and secure-note callback failures', async () => {
    const { store, write, validateNote } = fixture();
    const invalid = [
      { ...input, label: '' }, { ...input, color: 'red' }, { ...input, comment: 'x'.repeat(10001) },
      { ...input, anchor: { ...input.anchor, end: -1 } }, { ...input, path: 'C:\\note.md' },
      { ...input, path: '/note.md' }, { ...input, path: 'notes/../note.md' }, { ...input, path: 'notes/file.pdf' },
    ];
    for (const value of invalid) await expect(store.add(value as NewAnnotation)).rejects.toThrow();
    validateNote.mockRejectedValueOnce(new Error('Symlink rejected'));
    await expect(store.add(input)).rejects.toThrow('Symlink rejected');
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects corrupt metadata rather than overwriting it and scopes edits to the note', async () => {
    const corrupt = fixture({ version: 1, annotations: [{}] });
    await expect(corrupt.store.add(input)).rejects.toThrow();
    expect(corrupt.write).not.toHaveBeenCalled();
    const { store } = fixture();
    const added = await store.add(input);
    await expect(store.update('Other.md', added.id, { comment: 'no' })).rejects.toThrow('not found');
    await expect(store.update(input.path, added.id, { path: 'Other.md' } as never)).rejects.toThrow();
    expect(await store.list(input.path)).toEqual([added]);
  });

  it('migrates note and notebook paths on exact segment boundaries', async () => {
    const { store, validateNote } = fixture();
    await store.add(input);
    await store.add({ ...input, path: 'NotesTwo/Idea.md' });
    await store.migratePaths('Notes', 'Archive');
    expect(await store.list('Archive/Idea.md')).toHaveLength(1);
    expect(await store.list('NotesTwo/Idea.md')).toHaveLength(1);
    expect(validateNote).toHaveBeenCalledWith('Archive/Idea.md');
    await store.migratePaths('Archive/Idea.md', 'Archive/Renamed.md');
    expect(await store.list('Archive/Renamed.md')).toHaveLength(1);
  });

  it('does not save partial migrations when a destination validation fails', async () => {
    const { store, validateNote, write } = fixture();
    await store.add(input);
    write.mockClear();
    validateNote.mockRejectedValueOnce(new Error('No destination note'));
    await expect(store.migratePaths('Notes', 'Archive')).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(await store.list(input.path)).toHaveLength(1);
  });
});
