// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProtectedMetadataStore, writeProtectedSecurityConfig } from '../../electron/vault/metadata-protection';
import {
  createVaultSecurityConfig,
  generateVaultRecoveryKey,
  prepareVaultRecovery,
  resetVaultPasswordWithRecovery,
  rotateVaultRecoveryKey,
  unlockVault,
  type VaultSecurityConfig,
} from '../../electron/vault/security';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'a11y-metadata-protection-'));
  folders.push(folder);
  const password = 'correct horse battery';
  const legacy = await createVaultSecurityConfig(password);
  const recovery = generateVaultRecoveryKey();
  const prepared = await prepareVaultRecovery(legacy.config, password, recovery, null);
  legacy.key.fill(0);
  let config: VaultSecurityConfig = prepared.config;
  let locked = false;
  let failCommit = false;
  let failCleanup = false;
  let lockOnResolve: string | null = null;
  const content = { version: 2, annotations: [{ quote: 'private annotation words' }], pdfAnnotations: [] };
  await writeFile(path.join(folder, 'annotations.json'), JSON.stringify(content));
  const resolver = {
    resolveMetadata: async (name: string) => {
      if (lockOnResolve && name.startsWith(lockOnResolve)) locked = true;
      if (name === 'annotations.json' && failCleanup) throw new Error('cleanup failed');
      return path.join(folder, name);
    },
  };
  const access = () => ({
    key: prepared.key,
    assertCurrent: () => {
      if (locked) throw new Error('locked');
    },
  });
  const store = createProtectedMetadataStore({
    resolver,
    getConfig: () => config,
    access,
    commitConfig: async (next, authorization) => {
      if (failCommit) throw new Error('commit failed');
      await writeProtectedSecurityConfig(resolver, next, authorization);
      config = next;
    },
    readLegacy: async () => JSON.parse(await readFile(path.join(folder, 'annotations.json'), 'utf8')),
  });
  return {
    folder,
    password,
    recovery,
    key: prepared.key,
    content,
    store,
    config: () => config,
    lock: () => {
      locked = true;
    },
    failCommit: () => {
      failCommit = true;
    },
    failCleanup: (value: boolean) => {
      failCleanup = value;
    },
    lockOnResolve: (prefix: string) => {
      lockOnResolve = prefix;
    },
  };
}
describe('scoped encrypted metadata storage', () => {
  it.each([`pending-${randomUUID()}.json`, 'pending-annotations-old.json'])(
    'refuses legacy plaintext staging %s',
    async (name) => {
      const f = await fixture();
      await writeFile(path.join(f.folder, name), JSON.stringify(f.content));
      await expect(f.store.enable()).rejects.toThrow('legacy metadata staging');
      expect(f.store.enabled()).toBe(false);
      f.key.fill(0);
    },
  );
  it('commits bounded separated ciphertext and removes plaintext without plaintext staging', async () => {
    const f = await fixture();
    await f.store.enable();
    expect(await f.store.read('annotations')).toEqual(f.content);
    expect(await f.store.read('checkpoints')).toEqual({ version: 1, drafts: [] });
    const names = await readdir(f.folder);
    expect(names).not.toContain('annotations.json');
    expect(names.some((name) => name.startsWith('pending'))).toBe(false);
    for (const name of names)
      expect(await readFile(path.join(f.folder, name), 'utf8')).not.toContain('private annotation words');
    await f.store.write('annotations', { secret: 'updated annotation' });
    expect(await f.store.read('annotations')).toEqual({ secret: 'updated annotation' });
    expect((await readdir(f.folder)).filter((name) => name.startsWith('protected-annotations'))).toHaveLength(1);
    f.key.fill(0);
  });
  it('keeps legacy authoritative when the pointer commit fails', async () => {
    const f = await fixture();
    f.failCommit();
    await expect(f.store.enable()).rejects.toThrow('commit failed');
    expect(f.store.enabled()).toBe(false);
    expect(JSON.parse(await readFile(path.join(f.folder, 'annotations.json'), 'utf8'))).toEqual(f.content);
    f.key.fill(0);
  });
  it('blocks access after interrupted cleanup and durably retries it', async () => {
    const f = await fixture();
    f.failCleanup(true);
    await expect(f.store.enable()).rejects.toThrow('cleanup failed');
    expect(f.store.enabled()).toBe(true);
    await expect(f.store.read('annotations')).rejects.toThrow('cleanup');
    f.failCleanup(false);
    await f.store.finishCleanup();
    expect(await f.store.read('annotations')).toEqual(f.content);
    f.key.fill(0);
  });
  it('preserves the authoritative generation on failed writes and rejects oversized content', async () => {
    const f = await fixture();
    await f.store.enable();
    await expect(f.store.write('annotations', { content: 'x'.repeat(16 * 1024 * 1024) })).rejects.toThrow('size');
    f.failCommit();
    await expect(f.store.write('annotations', { private: 'uncommitted new content' })).rejects.toThrow('commit failed');
    expect(await f.store.read('annotations')).toEqual(f.content);
    f.key.fill(0);
  });
  it('rechecks lock generation during staging and never leaves plaintext or staging output', async () => {
    const f = await fixture();
    await f.store.enable();
    const config = JSON.stringify(f.config());
    f.lockOnResolve('protected-annotations-');
    await expect(f.store.write('annotations', { private: 'locked new content' })).rejects.toThrow('locked');
    expect(JSON.stringify(f.config())).toBe(config);
    for (const name of await readdir(f.folder)) {
      expect(name).not.toMatch(/^pending/);
      expect(await readFile(path.join(f.folder, name), 'utf8')).not.toContain('locked new content');
    }
    f.key.fill(0);
  });
  it('rejects swapped, missing and damaged ciphertext without plaintext fallback', async () => {
    const f = await fixture();
    await f.store.enable();
    const names = await readdir(f.folder);
    const annotations = path.join(
      f.folder,
      names.find((name) => name.startsWith('protected-annotations'))!,
    );
    const checkpoints = path.join(
      f.folder,
      names.find((name) => name.startsWith('protected-checkpoints'))!,
    );
    await writeFile(path.join(f.folder, 'annotations.json'), JSON.stringify(f.content));
    const original = await readFile(annotations, 'utf8');
    await writeFile(annotations, await readFile(checkpoints));
    await expect(f.store.read('annotations')).rejects.toThrow();
    const damaged = JSON.parse(original);
    damaged.record.tag = Buffer.alloc(16).toString('base64');
    await writeFile(annotations, JSON.stringify(damaged));
    await expect(f.store.read('annotations')).rejects.toThrow();
    await unlink(annotations);
    await expect(f.store.read('annotations')).rejects.toThrow();
    f.key.fill(0);
  });
  it('rejects protected container symlinks even with a permissive resolver', async () => {
    const f = await fixture();
    await f.store.enable();
    const name = (await readdir(f.folder)).find((item) => item.startsWith('protected-annotations'))!;
    const destination = path.join(f.folder, name);
    const moved = path.join(f.folder, 'copied-container.json');
    await writeFile(moved, await readFile(destination));
    await unlink(destination);
    await symlink(moved, destination);
    await expect(f.store.read('annotations')).rejects.toThrow();
    f.key.fill(0);
  });
  it('rejects stale cross-generation ciphertext, truncation and oversized containers', async () => {
    const f = await fixture();
    await f.store.enable();
    const previousName = (await readdir(f.folder)).find((item) => item.startsWith('protected-annotations'))!;
    const previous = await readFile(path.join(f.folder, previousName));
    await f.store.write('annotations', { version: 2, annotations: [], pdfAnnotations: [] });
    const currentName = (await readdir(f.folder)).find((item) => item.startsWith('protected-annotations'))!;
    const current = path.join(f.folder, currentName);
    await writeFile(current, previous);
    await expect(f.store.read('annotations')).rejects.toThrow('digest');
    await writeFile(current, '{"version":');
    await expect(f.store.read('annotations')).rejects.toThrow();
    const handle = await open(current, 'r+');
    try {
      await handle.truncate(24 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    await expect(f.store.read('annotations')).rejects.toThrow('container');
    f.key.fill(0);
  });
  it('rejects locked reads and publication and authenticates the pointer across recovery changes', async () => {
    const f = await fixture();
    await f.store.enable();
    const original = f.config();
    if (original.version !== 3) throw new Error('expected v3');
    const pointer = original.metadataProtection!;
    const tampered = { ...original, metadataProtection: { ...pointer, vaultId: randomUUID() } };
    await expect(unlockVault(tampered, f.password)).rejects.toThrow();
    const removed = { ...original };
    delete removed.metadataProtection;
    await expect(unlockVault(removed, f.password)).rejects.toThrow();
    const reset = await resetVaultPasswordWithRecovery(original, f.recovery, 'new vault password');
    expect(reset.config.version === 3 && reset.config.metadataProtection).toEqual(pointer);
    const revoked = rotateVaultRecoveryKey(reset.config, reset.key, null);
    expect(revoked.metadataProtection).toEqual(pointer);
    const unlocked = await unlockVault(revoked, 'new vault password');
    expect(unlocked.equals(f.key)).toBe(true);
    f.lock();
    await expect(f.store.read('annotations')).rejects.toThrow('locked');
    await expect(f.store.write('annotations', { secret: 'never published' })).rejects.toThrow('locked');
    for (const key of [f.key, reset.key, unlocked]) key.fill(0);
  });
});
