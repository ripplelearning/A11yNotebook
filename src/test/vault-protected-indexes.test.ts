// @vitest-environment node
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService, type VaultProtectedMetadataAdapter } from '../../electron/vault/service';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

function memoryAdapter(protectedNames: Array<'bookmarks.json' | 'links.json' | 'bibliography.json'>) {
  const data = new Map<string, unknown>();
  const adapter: VaultProtectedMetadataAdapter = {
    isProtected: (name) => protectedNames.includes(name),
    read: async (name) => data.get(name) ?? null,
    write: async (name, value) => {
      data.set(name, structuredClone(value));
    },
  };
  return { adapter, data };
}

describe('vault service with protected bookmarks and links', () => {
  it('keeps bookmarks entirely in the protected store when bookmarks are protected', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-protected-indexes-'));
    const { adapter, data } = memoryAdapter(['bookmarks.json']);
    const service = createVaultService(temporaryDirectory, undefined, adapter);
    await service.initialize();
    await service.createNote('Start.md');
    const added = await service.addBookmark('Start.md');
    expect(added).toHaveLength(1);
    expect(data.get('bookmarks.json')).toEqual(added);
    await expect(access(path.join(temporaryDirectory, '.a11ynotebook', 'bookmarks.json'))).rejects.toThrow();
    expect(await service.getBookmarks()).toEqual(added);
    const removed = await service.toggleBookmark('Start.md');
    expect(removed).toEqual([]);
    expect(data.get('bookmarks.json')).toEqual([]);
    await service.dispose();
  });

  it('propagates protected read failures instead of treating them as empty', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-protected-indexes-'));
    const failing: VaultProtectedMetadataAdapter = {
      isProtected: () => true,
      read: async () => {
        throw new Error('Protected metadata digest does not match.');
      },
      write: async () => undefined,
    };
    const service = createVaultService(temporaryDirectory, undefined, failing);
    await service.initialize();
    await expect(service.getBookmarks()).rejects.toThrow('digest does not match');
    await service.dispose();
  });

  it('writes the link index to the protected store and no plaintext cache when links are protected', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-protected-indexes-'));
    const { adapter, data } = memoryAdapter(['links.json']);
    const service = createVaultService(temporaryDirectory, undefined, adapter);
    await service.initialize();
    await service.createNote('Start.md');
    await service.saveNote('Start.md', '# Start\n\n[[Existing]]');
    await service.createNote('Existing.md');
    const index = await service.getLinkIndex();
    expect(data.get('links.json')).toEqual(index);
    await expect(access(path.join(temporaryDirectory, '.a11ynotebook', 'links.json'))).rejects.toThrow();
    await service.dispose();
  });

  it('migrates protected bookmark paths on rename without touching plaintext', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-protected-indexes-'));
    const { adapter, data } = memoryAdapter(['bookmarks.json']);
    const service = createVaultService(temporaryDirectory, undefined, adapter);
    await service.initialize();
    await service.createNote('Old.md');
    await service.addBookmark('Old.md');
    await service.moveEntry('Old.md', 'New.md');
    const stored = data.get('bookmarks.json') as Array<{ path: string }>;
    expect(stored.map((bookmark) => bookmark.path)).toEqual(['New.md']);
    await expect(access(path.join(temporaryDirectory, '.a11ynotebook', 'bookmarks.json'))).rejects.toThrow();
    await service.dispose();
  });
});
