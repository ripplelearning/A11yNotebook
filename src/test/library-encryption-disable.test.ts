// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService, type VaultLibraryEncryptionAdapter } from '../../electron/vault/service';
import {
  createLibraryEncryptionManifest,
  type LibraryEncryptionManifest,
} from '../../electron/vault/library-manifest';
import { encryptLibraryFile, newLibraryFileId } from '../../electron/vault/library-crypto';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

async function enabledFixture() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-library-disable-'));
  await writeFile(path.join(temporaryDirectory, 'Alpha.md'), '# Alpha\n\nsecret alpha words');
  await writeFile(path.join(temporaryDirectory, 'Beta.txt'), 'plain beta words');
  const { manifest, contentKey } = createLibraryEncryptionManifest(randomBytes(32));
  let current: LibraryEncryptionManifest | null = structuredClone(manifest);
  const adapter: VaultLibraryEncryptionAdapter = {
    manifest: () => current,
    contentKey: () => contentKey,
    manifestChanged: (next) => {
      current = structuredClone(next);
    },
  };
  const service = createVaultService(temporaryDirectory, undefined, undefined, adapter);
  await service.initialize();
  service.setLibraryManifest(structuredClone(manifest));
  await service.migrateToLibraryEncryption();
  return { service, current: () => current, contentKey, manifest };
}

describe('turning whole-library encryption off', () => {
  it('decrypts every note back to its exact original bytes and empties the manifest', async () => {
    const f = await enabledFixture();
    const manifest = f.current()!;
    manifest.state = 'decrypting';
    f.service.setLibraryManifest(manifest);
    await f.service.migrateFromLibraryEncryption();
    expect(Object.keys(f.current()?.files ?? {})).toEqual([]);
    expect(await readFile(path.join(temporaryDirectory, 'Alpha.md'), 'utf8')).toBe('# Alpha\n\nsecret alpha words');
    expect(await readFile(path.join(temporaryDirectory, 'Beta.txt'), 'utf8')).toBe('plain beta words');
    await f.service.dispose();
  });

  it('resumes a half-finished decryption: converted files just lose their entry', async () => {
    const f = await enabledFixture();
    // Simulate a crash after Beta was already decrypted but before
    // its manifest entry was removed.
    await writeFile(path.join(temporaryDirectory, 'Beta.txt'), 'plain beta words');
    const manifest = f.current()!;
    manifest.state = 'decrypting';
    f.service.setLibraryManifest(manifest);
    await f.service.migrateFromLibraryEncryption();
    expect(Object.keys(f.current()?.files ?? {})).toEqual([]);
    expect(await readFile(path.join(temporaryDirectory, 'Alpha.md'), 'utf8')).toBe('# Alpha\n\nsecret alpha words');
    expect(await readFile(path.join(temporaryDirectory, 'Beta.txt'), 'utf8')).toBe('plain beta words');
    await f.service.dispose();
  });

  it('refuses to treat a plaintext listed file as converted while fully active', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-library-disable-'));
    await writeFile(path.join(temporaryDirectory, 'Alpha.md'), '# Alpha\n\nsecret alpha words');
    const { manifest, contentKey } = createLibraryEncryptionManifest(randomBytes(32));
    const fileId = newLibraryFileId();
    manifest.state = 'active';
    manifest.files['Alpha.md'] = { fileId, plainLength: 26, containerLength: 100 };
    let current: LibraryEncryptionManifest | null = structuredClone(manifest);
    const adapter: VaultLibraryEncryptionAdapter = {
      manifest: () => current,
      contentKey: () => contentKey,
      manifestChanged: (next) => {
        current = structuredClone(next);
      },
    };
    const service = createVaultService(temporaryDirectory, undefined, undefined, adapter);
    await service.initialize();
    service.setLibraryManifest(structuredClone(manifest));
    await expect(service.migrateFromLibraryEncryption()).rejects.toThrow(/stored in plaintext/);
    await service.dispose();
  });

  it('a tampered container fails the decryption loudly instead of writing garbage', async () => {
    const f = await enabledFixture();
    const container = await readFile(path.join(temporaryDirectory, 'Alpha.md'));
    const tampered = Buffer.from(container);
    tampered[tampered.length - 1] ^= 0xff;
    await writeFile(path.join(temporaryDirectory, 'Alpha.md'), tampered);
    const manifest = f.current()!;
    manifest.state = 'decrypting';
    f.service.setLibraryManifest(manifest);
    await expect(f.service.migrateFromLibraryEncryption()).rejects.toThrow();
    // The entry remains so the operation can be retried.
    expect(Object.keys(f.current()?.files ?? {})).toContain('Alpha.md');
    await f.service.dispose();
  });

  it('the fixture key really encrypts (sanity for the other cases)', async () => {
    const container = encryptLibraryFile(randomBytes(32), newLibraryFileId(), Buffer.from('x'));
    expect(container.subarray(0, 8).toString('ascii')).toBe('A11YLIB1');
  });
});
