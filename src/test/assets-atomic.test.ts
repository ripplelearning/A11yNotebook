// @vitest-environment node
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetStore } from '../../electron/vault/assets';
import { encryptRecord } from '../../electron/vault/security';
import type { createMetadataStore } from '../../electron/vault/metadata';

const state = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (state.fail && path.basename(String(args[0])).startsWith('.asset-')) {
        await actual.writeFile(args[0], 'partial', args[2]);
        throw new Error('Disk full');
      }
      return actual.writeFile(...args);
    },
  };
});
const roots: string[] = [];
afterEach(async () => {
  state.fail = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = path.resolve(`.asset-test-${randomUUID()}`);
  roots.push(root);
  await mkdir(root);
  await writeFile(path.join(root, 'Plan.outline.md'), '- Before\n');
  const store = createAssetStore(
    { resolveEntry: async (relative) => path.join(root, relative) },
    {} as ReturnType<typeof createMetadataStore>,
  );
  return { root, store };
}
describe('atomic cognitive source saves', () => {
  it('rejects encrypted notes routed through a cognitive extension without exposing a draft', async () => {
    const { root, store } = await setup();
    const envelope = encryptRecord(Buffer.alloc(32, 1), 'note', randomUUID(), '- Protected plaintext\n');
    await writeFile(path.join(root, 'Plan.outline.md'), JSON.stringify(envelope));
    await expect(store.read('Plan.outline.md')).rejects.toThrow('Encrypted notes');
    await expect(store.save('Plan.outline.md', '- Overwrite\n', JSON.stringify(envelope))).rejects.toThrow(
      'Encrypted notes',
    );
    expect(await readFile(path.join(root, 'Plan.outline.md'), 'utf8')).toBe(JSON.stringify(envelope));
  });
  it('preserves source and removes partial staging on failure', async () => {
    const { root, store } = await setup();
    state.fail = true;
    await expect(store.save('Plan.outline.md', '- After\n', '- Before\n')).rejects.toThrow('Disk full');
    expect(await readFile(path.join(root, 'Plan.outline.md'), 'utf8')).toBe('- Before\n');
    expect(await readdir(root)).toEqual(['Plan.outline.md']);
  });
  it('rechecks authorization before replacement and succeeds with matching baseline', async () => {
    const { root, store } = await setup();
    await expect(
      store.save('Plan.outline.md', '- After\n', '- Before\n', () => {
        throw new Error('Locked');
      }),
    ).rejects.toThrow('Locked');
    expect(await readFile(path.join(root, 'Plan.outline.md'), 'utf8')).toBe('- Before\n');
    await store.save('Plan.outline.md', '- After\n', '- Before\n');
    expect(await readFile(path.join(root, 'Plan.outline.md'), 'utf8')).toBe('- After\n');
    await expect(store.save('Plan.outline.md', '- Lost\n', '- Before\n')).rejects.toThrow('changed');
  });
});
