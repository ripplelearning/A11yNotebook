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

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x42]);
const CSV_TEXT = 'front,back\ncapital of France,Paris\n';

async function fixture() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-library-attach-'));
  await writeFile(path.join(temporaryDirectory, 'Alpha.md'), '# Alpha\n\nsecret alpha words');
  await writeFile(path.join(temporaryDirectory, 'photo.png'), PNG_BYTES);
  await writeFile(path.join(temporaryDirectory, 'deck.csv'), CSV_TEXT);
  const { manifest, contentKey } = createLibraryEncryptionManifest(randomBytes(32));
  let current: LibraryEncryptionManifest | null = null;
  const adapter: VaultLibraryEncryptionAdapter = {
    manifest: () => current,
    contentKey: () => contentKey,
    manifestChanged: (next) => {
      current = structuredClone(next);
    },
  };
  const service = createVaultService(temporaryDirectory, undefined, undefined, adapter);
  await service.initialize();
  return {
    service,
    enable: async () => {
      current = structuredClone(manifest);
      service.setLibraryManifest(structuredClone(manifest));
      await service.migrateToLibraryEncryption();
    },
    current: () => current,
  };
}

describe('whole-library encryption covers attachments', () => {
  it('migrates binary files byte-exactly, covers them, and imports are born encrypted', async () => {
    const f = await fixture();
    await f.enable();
    expect(Object.keys(f.current()?.files ?? {}).sort()).toEqual(['Alpha.md', 'deck.csv', 'photo.png']);
    const rawPng = await readFile(path.join(temporaryDirectory, 'photo.png'));
    expect(rawPng.subarray(0, 8).toString('ascii')).toBe('A11YLIB1');
    expect(f.service.libraryEncryptionCovers('photo.png')).toBe(true);
    expect(f.service.libraryEncryptionCovers('missing.png')).toBe(false);
    expect(f.service.decodeFileBytes('photo.png', rawPng).equals(PNG_BYTES)).toBe(true);
    // Importing a new attachment encrypts it at creation.
    await f.service.createDocument('scan.png', PNG_BYTES, 'imported');
    const rawScan = await readFile(path.join(temporaryDirectory, 'scan.png'));
    expect(rawScan.subarray(0, 8).toString('ascii')).toBe('A11YLIB1');
    expect(f.service.decodeFileBytes('scan.png', rawScan).equals(PNG_BYTES)).toBe(true);
    // Search finds the CSV content in plaintext, not container bytes.
    const results = await f.service.search({ text: 'Paris' });
    expect(results.map((result) => result.path)).toContain('deck.csv');
    await f.service.dispose();
  });

  it('the opt-out restores attachments byte-for-byte', async () => {
    const f = await fixture();
    await f.enable();
    const manifest = f.current()!;
    manifest.state = 'decrypting';
    f.service.setLibraryManifest(manifest);
    await f.service.migrateFromLibraryEncryption();
    expect(Object.keys(f.current()?.files ?? {})).toEqual([]);
    expect((await readFile(path.join(temporaryDirectory, 'photo.png'))).equals(PNG_BYTES)).toBe(true);
    expect(await readFile(path.join(temporaryDirectory, 'deck.csv'), 'utf8')).toBe(CSV_TEXT);
    await f.service.dispose();
  });
});
