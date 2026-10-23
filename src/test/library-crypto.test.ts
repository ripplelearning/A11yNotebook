// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  createLibraryDecryptionStream,
  createLibraryEncryptionStream,
  decryptLibraryFile,
  encryptLibraryFile,
  LIBRARY_CHUNK_SIZE,
  newLibraryFileId,
} from '../../electron/vault/library-crypto';
import {
  createLibraryEncryptionManifest,
  openLibraryContentKey,
  validateLibraryEncryptionManifest,
} from '../../electron/vault/library-manifest';

const contentKey = randomBytes(32);

describe('library container format', () => {
  it('round-trips empty, small, and multi-chunk plaintexts', () => {
    for (const size of [0, 1, 100, LIBRARY_CHUNK_SIZE, LIBRARY_CHUNK_SIZE + 1, LIBRARY_CHUNK_SIZE * 2 + 123]) {
      const fileId = newLibraryFileId();
      const plaintext = randomBytes(size);
      const container = encryptLibraryFile(contentKey, fileId, plaintext);
      expect(decryptLibraryFile(contentKey, fileId, container).equals(plaintext)).toBe(true);
    }
  });

  it('rejects the wrong key, the wrong file id, and spliced containers', () => {
    const fileId = newLibraryFileId();
    const otherId = newLibraryFileId();
    const container = encryptLibraryFile(contentKey, fileId, Buffer.from('private library words'));
    expect(() => decryptLibraryFile(randomBytes(32), fileId, container)).toThrow();
    expect(() => decryptLibraryFile(contentKey, otherId, container)).toThrow();
    const other = encryptLibraryFile(contentKey, otherId, Buffer.from('other file words here'));
    const spliced = Buffer.concat([container, other.subarray(other.length - 40)]);
    expect(() => decryptLibraryFile(contentKey, fileId, spliced)).toThrow();
  });

  it('rejects truncation, trailing data, bit flips, and chunk reordering', () => {
    const fileId = newLibraryFileId();
    const plaintext = randomBytes(LIBRARY_CHUNK_SIZE * 2 + 10);
    const container = encryptLibraryFile(contentKey, fileId, plaintext);
    expect(() => decryptLibraryFile(contentKey, fileId, container.subarray(0, container.length - 5))).toThrow();
    expect(() => decryptLibraryFile(contentKey, fileId, Buffer.concat([container, Buffer.from('x')]))).toThrow();
    const flipped = Buffer.from(container);
    flipped[flipped.length - 20] ^= 0xff;
    expect(() => decryptLibraryFile(contentKey, fileId, flipped)).toThrow();
    // Swap the first two framed chunks (equal lengths here).
    const headerLength = 12 + container.readUInt32BE(8);
    const firstChunkLength = 4 + container.readUInt32BE(headerLength);
    const chunk1 = container.subarray(headerLength, headerLength + firstChunkLength);
    const chunk2 = container.subarray(headerLength + firstChunkLength, headerLength + firstChunkLength * 2);
    const reordered = Buffer.concat([
      container.subarray(0, headerLength),
      chunk2,
      chunk1,
      container.subarray(headerLength + firstChunkLength * 2),
    ]);
    expect(() => decryptLibraryFile(contentKey, fileId, reordered)).toThrow();
  });

  it('streams a multi-chunk file in small pieces with the same authentication', async () => {
    const fileId = newLibraryFileId();
    const plaintext = randomBytes(LIBRARY_CHUNK_SIZE * 3 + 999);
    const { stream: encryptor, headerChunk } = createLibraryEncryptionStream(contentKey, fileId, plaintext.length);
    const encryptedParts: Buffer[] = [headerChunk];
    await pipeline(
      Readable.from((function* () {
        for (let offset = 0; offset < plaintext.length; offset += 1000) yield plaintext.subarray(offset, offset + 1000);
      })()),
      encryptor,
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          encryptedParts.push(chunk);
          callback();
        },
      }),
    );
    const container = Buffer.concat(encryptedParts);
    const decryptedParts: Buffer[] = [];
    await pipeline(
      Readable.from((function* () {
        for (let offset = 0; offset < container.length; offset += 777) yield container.subarray(offset, offset + 777);
      })()),
      createLibraryDecryptionStream(contentKey, fileId),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          decryptedParts.push(chunk);
          callback();
        },
      }),
    );
    expect(Buffer.concat(decryptedParts).equals(plaintext)).toBe(true);
    // And the streamed container decrypts with the buffer API too.
    expect(decryptLibraryFile(contentKey, fileId, container).equals(plaintext)).toBe(true);
  });

  it('fails streaming decryption on a truncated container', async () => {
    const fileId = newLibraryFileId();
    const container = encryptLibraryFile(contentKey, fileId, Buffer.from('streamed words'));
    await expect(
      pipeline(
        Readable.from([container.subarray(0, container.length - 3)]),
        createLibraryDecryptionStream(contentKey, fileId),
        new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      ),
    ).rejects.toThrow();
  });
});

describe('library encryption manifest', () => {
  it('wraps and unwraps the content key under the data key only', () => {
    const dataKey = randomBytes(32);
    const { manifest, contentKey: created } = createLibraryEncryptionManifest(dataKey);
    validateLibraryEncryptionManifest(manifest);
    expect(manifest.state).toBe('migrating');
    const opened = openLibraryContentKey(dataKey, manifest);
    expect(opened.equals(created)).toBe(true);
    expect(() => openLibraryContentKey(randomBytes(32), manifest)).toThrow();
    created.fill(0);
    opened.fill(0);
  });

  it('rejects malformed manifests', () => {
    const dataKey = randomBytes(32);
    const { manifest, contentKey: created } = createLibraryEncryptionManifest(dataKey);
    created.fill(0);
    expect(() => validateLibraryEncryptionManifest({ ...manifest, state: 'done' })).toThrow();
    expect(() =>
      validateLibraryEncryptionManifest({ ...manifest, files: { 'a/../b.md': { fileId: 'x', plainLength: 0, containerLength: 0 } } }),
    ).toThrow();
    expect(() =>
      validateLibraryEncryptionManifest({
        ...manifest,
        files: { 'Note.md': { fileId: 'not-a-uuid', plainLength: 0, containerLength: 0 } },
      }),
    ).toThrow();
  });
});
