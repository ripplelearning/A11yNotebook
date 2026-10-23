// @vitest-environment node
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSearchIndex, type SearchIndexProtectionAdapter } from '../../electron/vault/search';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

async function vault() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-search-protection-'));
  await writeFile(path.join(temporaryDirectory, 'Note.md'), '# Title\n\nfindable protected words');
  return temporaryDirectory;
}

describe('search index with encrypted cache protection', () => {
  it('persists only through the adapter and never writes the plaintext cache', async () => {
    const root = await vault();
    let stored: unknown = null;
    const adapter: SearchIndexProtectionAdapter = {
      isProtected: () => true,
      read: async () => stored,
      write: async (value) => {
        stored = structuredClone(value);
      },
    };
    const index = createSearchIndex(root, adapter);
    await index.initialize();
    expect((await index.search({ text: 'findable' })).map((result) => result.path)).toEqual(['Note.md']);
    expect(stored).toMatchObject({ version: 4, root });
    await expect(access(path.join(root, '.a11ynotebook', 'search-index.json'))).rejects.toThrow();
    await index.dispose();
  });

  it('keeps searching from the rebuild when protected persistence is unavailable (locked)', async () => {
    const root = await vault();
    const adapter: SearchIndexProtectionAdapter = {
      isProtected: () => true,
      read: async () => {
        throw new Error('locked');
      },
      write: async () => {
        throw new Error('locked');
      },
    };
    const index = createSearchIndex(root, adapter);
    await index.initialize();
    expect((await index.search({ text: 'protected' })).map((result) => result.path)).toEqual(['Note.md']);
    await index.refresh();
    await expect(access(path.join(root, '.a11ynotebook', 'search-index.json'))).rejects.toThrow();
    await index.dispose();
  });

  it('still uses the plaintext cache when protection is off', async () => {
    const root = await vault();
    const adapter: SearchIndexProtectionAdapter = {
      isProtected: () => false,
      read: async () => {
        throw new Error('must not be called');
      },
      write: async () => {
        throw new Error('must not be called');
      },
    };
    const index = createSearchIndex(root, adapter);
    await index.initialize();
    await expect(access(path.join(root, '.a11ynotebook', 'search-index.json'))).resolves.toBeUndefined();
    await index.dispose();
  });
});
