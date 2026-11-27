// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetadataStore } from '../../electron/vault/metadata';

// Replacing a sidecar file is a rename over the previous copy, and on
// Windows that rename can be refused for a moment while another process
// holds the file open. Fail the rename a controlled number of times to
// prove the write retries lock errors instead of failing at once.
const fault = vi.hoisted(() => ({ failuresLeft: 0, code: 'EPERM', calls: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      fault.calls += 1;
      if (fault.failuresLeft > 0) {
        fault.failuresLeft -= 1;
        throw Object.assign(new Error(`mock rename refused (${fault.code})`), { code: fault.code });
      }
      return actual.rename(...args);
    },
  };
});

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
beforeEach(() => {
  fault.failuresLeft = 0;
  fault.code = 'EPERM';
  fault.calls = 0;
});

async function makeStore() {
  const folder = await mkdtemp(path.join(tmpdir(), 'a11y-metadata-retry-'));
  folders.push(folder);
  const metadataDir = path.join(folder, '.a11ynotebook');
  await mkdir(metadataDir, { recursive: true });
  const store = createMetadataStore({
    resolveMetadata: async (name: string) => path.join(metadataDir, name),
  });
  return { folder, metadataDir, store };
}

describe('metadata writes under a transient file lock', () => {
  it('retries a refused rename once and still writes the value', async () => {
    const { metadataDir, store } = await makeStore();
    fault.failuresLeft = 1;
    await store.write('provenance.json', { version: 1, records: { abc: 'created' } });
    expect(fault.calls).toBe(2);
    expect(JSON.parse(await readFile(path.join(metadataDir, 'provenance.json'), 'utf8'))).toEqual({
      version: 1,
      records: { abc: 'created' },
    });
    expect(await readdir(metadataDir)).toEqual(['provenance.json']);
  });

  it('gives up after repeated refusals and leaves no staging file', async () => {
    const { metadataDir, store } = await makeStore();
    fault.failuresLeft = 10;
    await expect(store.write('provenance.json', { version: 1, records: {} })).rejects.toMatchObject({
      code: 'EPERM',
    });
    expect(fault.calls).toBe(3);
    expect(await readdir(metadataDir)).toEqual([]);
  });

  it('does not retry a refusal that is not a lock error', async () => {
    const { store } = await makeStore();
    fault.failuresLeft = 1;
    fault.code = 'ENOENT';
    await expect(store.write('provenance.json', { version: 1, records: {} })).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(fault.calls).toBe(1);
  });
});
