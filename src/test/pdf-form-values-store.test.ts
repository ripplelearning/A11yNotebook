// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPdfFormValueStore } from '../../electron/vault/pdf-form-values';

function memoryStore() {
  let saved: unknown = null;
  return {
    store: createPdfFormValueStore({
      read: async () => saved,
      write: async (value) => {
        saved = value;
      },
      validatePdf: async (path) => {
        if (!/\.pdf$/i.test(path)) throw new Error('Filled form values require a PDF document.');
      },
    }),
    snapshot: () => saved,
  };
}

const identity = { fingerprint: 'fp', fileHash: 'hash', vaultPath: 'Forms/fillable.pdf' };

describe('filled PDF values store', () => {
  it('saves and reads values keyed by document path', async () => {
    const { store } = memoryStore();
    expect(await store.get('Forms/fillable.pdf')).toEqual({});
    const saved = await store.save('Forms/fillable.pdf', { fullName: 'Ada', agree: true }, identity);
    expect(saved.values).toEqual({ fullName: 'Ada', agree: true });
    expect(saved.schemaVersion).toBe(1);
    expect(await store.get('Forms/fillable.pdf')).toEqual({ fullName: 'Ada', agree: true });
    await store.save('Forms/fillable.pdf', { fullName: 'Grace' }, identity);
    expect(await store.get('Forms/fillable.pdf')).toEqual({ fullName: 'Grace' });
  });

  it('rejects bad paths, mismatched identity, and bad values', async () => {
    const { store } = memoryStore();
    await expect(store.get('../outside.pdf')).rejects.toThrow('Invalid filled form document path');
    await expect(store.get('Forms/note.md')).rejects.toThrow('Filled form values require a PDF document');
    await expect(
      store.save('Forms/fillable.pdf', { fullName: 'Ada' }, { ...identity, vaultPath: 'Forms/other.pdf' }),
    ).rejects.toThrow('does not match');
    await expect(store.save('Forms/fillable.pdf', { fullName: 42 as unknown as string }, identity)).rejects.toThrow(
      'Invalid filled form value',
    );
    await expect(store.save('Forms/fillable.pdf', { '': 'x' }, identity)).rejects.toThrow(
      'Invalid filled form field name',
    );
  });

  it('migrates values when the document moves', async () => {
    const { store } = memoryStore();
    await store.save('Forms/fillable.pdf', { fullName: 'Ada' }, identity);
    await store.migratePaths('Forms/fillable.pdf', 'Archive/fillable.pdf');
    expect(await store.get('Forms/fillable.pdf')).toEqual({});
    expect(await store.get('Archive/fillable.pdf')).toEqual({ fullName: 'Ada' });
  });
});
