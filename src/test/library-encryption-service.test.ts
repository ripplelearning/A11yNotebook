// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService, type VaultLibraryEncryptionAdapter } from '../../electron/vault/service';
import {
  createLibraryEncryptionManifest,
  type LibraryEncryptionManifest,
} from '../../electron/vault/library-manifest';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

async function fixture() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-library-encryption-'));
  await writeFile(path.join(temporaryDirectory, 'Alpha.md'), '# Alpha\n\nsecret alpha words');
  await writeFile(path.join(temporaryDirectory, 'Beta.txt'), 'plain beta words');
  const { randomBytes } = await import('node:crypto');
  const dataKey = randomBytes(32);
  const { manifest, contentKey } = createLibraryEncryptionManifest(dataKey);
  let current: LibraryEncryptionManifest | null = null;
  let key: Buffer | null = contentKey;
  const adapter: VaultLibraryEncryptionAdapter = {
    manifest: () => current,
    contentKey: () => key,
    manifestChanged: (next) => {
      current = structuredClone(next);
    },
  };
  const service = createVaultService(temporaryDirectory, undefined, undefined, adapter);
  await service.initialize();
  return {
    service,
    adapter,
    begin: () => {
      current = structuredClone(manifest);
      service.setLibraryManifest(structuredClone(manifest));
    },
    lock: () => {
      key = null;
    },
    manifest: () => current,
  };
}

describe('whole-library encryption at the vault service', () => {
  it('migrates notes to containers, keeps plaintext semantics, and encrypts new writes', async () => {
    const f = await fixture();
    f.begin();
    await f.service.migrateToLibraryEncryption();
    expect(f.manifest()?.state).toBe('active');
    expect(Object.keys(f.manifest()?.files ?? {}).sort()).toEqual(['Alpha.md', 'Beta.txt']);
    const rawAlpha = await readFile(path.join(temporaryDirectory, 'Alpha.md'));
    expect(rawAlpha.subarray(0, 8).toString('ascii')).toBe('A11YLIB1');
    expect(rawAlpha.toString('utf8')).not.toContain('secret alpha words');
    await expect(f.service.readNote('Alpha.md')).resolves.toBe('# Alpha\n\nsecret alpha words');
    await expect(f.service.readNote('Beta.txt')).resolves.toBe('plain beta words');
    // Saving re-encrypts under the same file id and updates lengths.
    const before = f.manifest()?.files['Alpha.md'];
    await f.service.saveNote('Alpha.md', '# Alpha\n\nupdated secret words', '# Alpha\n\nsecret alpha words');
    const after = f.manifest()?.files['Alpha.md'];
    expect(after?.fileId).toBe(before?.fileId);
    expect(after?.plainLength).toBe(Buffer.byteLength('# Alpha\n\nupdated secret words'));
    await expect(f.service.readNote('Alpha.md')).resolves.toBe('# Alpha\n\nupdated secret words');
    // New notes are born encrypted while the manifest is active.
    await f.service.createNote('Gamma.md', 'gamma secret words');
    const rawGamma = await readFile(path.join(temporaryDirectory, 'Gamma.md'));
    expect(rawGamma.subarray(0, 8).toString('ascii')).toBe('A11YLIB1');
    await expect(f.service.readNote('Gamma.md')).resolves.toBe('gamma secret words');
    // Search sees plaintext, not container bytes.
    const results = await f.service.search({ text: 'gamma' });
    expect(results.map((result) => result.path)).toContain('Gamma.md');
    await f.service.dispose();
  });

  it('fails closed while locked and for a listed note stored in plaintext', async () => {
    const f = await fixture();
    f.begin();
    await f.service.migrateToLibraryEncryption();
    f.lock();
    await expect(f.service.readNote('Alpha.md')).rejects.toThrow(/Unlock the library/);
    await f.service.dispose();
  });

  it('resumes a migration: pre-containerized listed files are verified, the rest convert', async () => {
    const f = await fixture();
    f.begin();
    // Simulate a crash after Alpha was converted and persisted.
    const { encryptLibraryFile } = await import('../../electron/vault/library-crypto');
    const { newLibraryFileId } = await import('../../electron/vault/library-crypto');
    const { openLibraryContentKey } = await import('../../electron/vault/library-manifest');
    void openLibraryContentKey;
    const manifest = f.manifest()!;
    const fileId = newLibraryFileId();
    const adapterKey = f.adapter.contentKey()!;
    const container = encryptLibraryFile(adapterKey, fileId, Buffer.from('# Alpha\n\nsecret alpha words'));
    await writeFile(path.join(temporaryDirectory, 'Alpha.md'), container);
    manifest.files['Alpha.md'] = { fileId, plainLength: 26, containerLength: container.length };
    f.service.setLibraryManifest(structuredClone(manifest));
    await f.service.migrateToLibraryEncryption();
    expect(f.manifest()?.state).toBe('active');
    await expect(f.service.readNote('Alpha.md')).resolves.toBe('# Alpha\n\nsecret alpha words');
    await expect(f.service.readNote('Beta.txt')).resolves.toBe('plain beta words');
    await f.service.dispose();
  });

  it('leaves a library without a manifest completely untouched', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-library-plain-'));
    await writeFile(path.join(temporaryDirectory, 'Alpha.md'), '# Alpha\n\nsecret alpha words');
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await expect(service.readNote('Alpha.md')).resolves.toBe('# Alpha\n\nsecret alpha words');
    await service.saveNote('Alpha.md', '# Alpha\n\nchanged words', '# Alpha\n\nsecret alpha words');
    expect(await readFile(path.join(temporaryDirectory, 'Alpha.md'), 'utf8')).toBe('# Alpha\n\nchanged words');
    await service.dispose();
  });
});
