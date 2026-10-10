// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAssetDraftStore } from '../../electron/vault/asset-drafts';
import { ASSET_DRAFT_RETENTION_MS } from '../shared/asset-drafts';

function setup() {
  let value: unknown = null;
  let time = Date.parse('2026-10-10T00:00:00.000Z');
  const storage = {
    read: async () => value,
    write: async (next: unknown) => {
      value = next;
    },
  };
  return {
    store: createAssetDraftStore(storage, () => time),
    get: () => value,
    put: (next: unknown) => {
      value = next;
    },
    advance: () => {
      time += ASSET_DRAFT_RETENTION_MS;
    },
  };
}
const input = { path: 'Plan.outline.md', type: 'outline', baselineContent: '- Original\n', content: '- Unsaved\n' };

describe('bounded encrypted-store cognitive drafts', () => {
  it('retains baseline, revisions and incomplete source without touching the source', async () => {
    const { store } = setup();
    const first = await store.checkpoint(input);
    expect(await store.read(input.path)).toEqual(first);
    expect(first.baselineHash).toMatch(/^[a-f0-9]{64}$/);
    const second = await store.checkpoint({ ...input, content: 'incomplete' });
    expect(second.revision).not.toBe(first.revision);
    await store.discard(input.path, first.revision);
    expect(await store.read(input.path)).toEqual(second);
    await store.discard(input.path, second.revision);
    expect(await store.read(input.path)).toBeNull();
  });
  it('follows folder moves and deletes and expires at seven days', async () => {
    const { store, advance } = setup();
    await store.checkpoint({ ...input, path: `Old/${input.path}` });
    await store.migratePaths('Old', 'New');
    expect(await store.read(`Old/${input.path}`)).toBeNull();
    expect(await store.read(`New/${input.path}`)).not.toBeNull();
    await store.deletePaths('New');
    expect(await store.read(`New/${input.path}`)).toBeNull();
    await store.checkpoint(input);
    advance();
    expect(await store.read(input.path)).toBeNull();
  });
  it('rejects traversal, mismatched types, bad baseline hashes and unsupported schemas', async () => {
    const { store, put, get } = setup();
    await expect(store.checkpoint({ ...input, path: '../Plan.outline.md' })).rejects.toThrow('path');
    await expect(store.checkpoint({ ...input, type: 'mindmap' })).rejects.toThrow('content');
    await store.checkpoint(input);
    const value = get() as { version: number; drafts: Record<string, unknown>[] };
    put({ ...value, drafts: [{ ...value.drafts[0], baselineHash: '0'.repeat(64) }] });
    await expect(store.read(input.path)).rejects.toThrow('record');
    put({ version: 2, drafts: [] });
    await expect(store.read(input.path)).rejects.toThrow('schema');
  });
  it('propagates protected storage errors with no plaintext fallback', async () => {
    const store = createAssetDraftStore({
      read: async () => {
        throw new Error('Authentication failed');
      },
      write: async () => {
        throw new Error('Should not write');
      },
    });
    await expect(store.checkpoint(input)).rejects.toThrow('Authentication');
    await expect(store.read(input.path)).rejects.toThrow('Authentication');
  });
  it('bounds record counts and refuses lossy migrations to a different asset type', async () => {
    const { store } = setup();
    for (let index = 0; index < 20; index += 1) await store.checkpoint({ ...input, path: `Plan${index}.outline.md` });
    await expect(store.checkpoint(input)).rejects.toThrow('full');
    await expect(store.migratePaths('Plan0.outline.md', 'Plan0.csv')).rejects.toThrow('content');
    expect(await store.read('Plan0.outline.md')).not.toBeNull();
  });
});
