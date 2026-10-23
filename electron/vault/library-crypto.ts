import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Whole-library encryption container format (foundation).
 *
 * Each library file is encrypted independently under a per-file key
 * derived from the library content key:
 *   fileKey = HKDF(contentKey, salt = fileId, info = 'a11ynotebook:library-file:v1')
 *
 * Layout: an 8-byte magic, a uint32 header length, a JSON header
 * ({version, fileId, chunkSize, plainLength, baseNonce}), then
 * length-prefixed chunks. Chunk i is AES-256-GCM with nonce
 * baseNonce XOR i and AAD binding the file id, the chunk index, and
 * whether it is the final chunk — so reordering, splicing chunks
 * across files, and truncation all fail authentication, and the
 * decryptor additionally requires the plaintext to total exactly
 * the header's plainLength. Encryption is streaming with one chunk
 * (64 KiB) of memory at a time, so attachment size is not bounded
 * by RAM.
 */
export const LIBRARY_CONTAINER_MAGIC = 'A11YLIB1';
export const LIBRARY_CHUNK_SIZE = 64 * 1024;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 4096;

export interface LibraryContainerHeader {
  version: 1;
  fileId: string;
  chunkSize: number;
  plainLength: number;
  baseNonce: string;
}

function fileKey(contentKey: Buffer, fileId: string): Buffer {
  if (contentKey.length !== 32) throw new Error('Invalid library content key.');
  return Buffer.from(
    hkdfSync('sha256', contentKey, Buffer.from(fileId, 'utf8'), 'a11ynotebook:library-file:v1', 32),
  );
}

function chunkNonce(baseNonce: Buffer, index: number): Buffer {
  const nonce = Buffer.from(baseNonce);
  let value = BigInt(index);
  for (let offset = NONCE_BYTES - 1; offset >= 4 && value > 0n; offset -= 1) {
    nonce[offset] ^= Number(value & 0xffn);
    value >>= 8n;
  }
  return nonce;
}

function chunkAad(fileId: string, index: number, final: boolean): Buffer {
  return Buffer.from(`a11ylib:v1:${fileId}:${index}:${final ? 'final' : 'chunk'}`, 'utf8');
}

function encryptChunk(key: Buffer, fileId: string, baseNonce: Buffer, index: number, chunk: Buffer, final: boolean): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, chunkNonce(baseNonce, index), { authTagLength: TAG_BYTES });
  cipher.setAAD(chunkAad(fileId, index, final));
  const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]);
}

function decryptChunk(key: Buffer, fileId: string, baseNonce: Buffer, index: number, sealed: Buffer, final: boolean): Buffer {
  if (sealed.length < TAG_BYTES) throw new Error('Library container is truncated.');
  const decipher = createDecipheriv('aes-256-gcm', key, chunkNonce(baseNonce, index), { authTagLength: TAG_BYTES });
  decipher.setAAD(chunkAad(fileId, index, final));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
}

function headerBytes(header: LibraryContainerHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  if (json.length > MAX_HEADER_BYTES) throw new Error('Library container header is too large.');
  const prefix = Buffer.alloc(8 + 4);
  prefix.write(LIBRARY_CONTAINER_MAGIC, 0, 'ascii');
  prefix.writeUInt32BE(json.length, 8);
  return Buffer.concat([prefix, json]);
}

export function parseLibraryContainerHeader(container: Buffer): { header: LibraryContainerHeader; offset: number } {
  if (container.length < 12 || container.subarray(0, 8).toString('ascii') !== LIBRARY_CONTAINER_MAGIC)
    throw new Error('Not a library encryption container.');
  const length = container.readUInt32BE(8);
  if (length === 0 || length > MAX_HEADER_BYTES || container.length < 12 + length)
    throw new Error('Library container header is malformed.');
  let header: LibraryContainerHeader;
  try {
    header = JSON.parse(container.subarray(12, 12 + length).toString('utf8')) as LibraryContainerHeader;
  } catch {
    throw new Error('Library container header is malformed.');
  }
  if (
    header.version !== 1 ||
    typeof header.fileId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(header.fileId) ||
    header.chunkSize !== LIBRARY_CHUNK_SIZE ||
    !Number.isSafeInteger(header.plainLength) ||
    header.plainLength < 0 ||
    Buffer.from(header.baseNonce, 'base64').length !== NONCE_BYTES
  )
    throw new Error('Library container header is malformed.');
  return { header, offset: 12 + length };
}

export function createLibraryEncryptionStream(
  contentKey: Buffer,
  fileId: string,
  plainLength: number,
): { stream: Transform; headerChunk: Buffer } {
  const key = fileKey(contentKey, fileId);
  const baseNonce = randomBytes(NONCE_BYTES);
  const headerChunk = headerBytes({
    version: 1,
    fileId,
    chunkSize: LIBRARY_CHUNK_SIZE,
    plainLength,
    baseNonce: baseNonce.toString('base64'),
  });
  let pending = Buffer.alloc(0);
  let index = 0;
  let seen = 0;
  const emit = (chunk: Buffer, final: boolean, push: (data: Buffer) => void) => {
    const sealed = encryptChunk(key, fileId, baseNonce, index, chunk, final);
    index += 1;
    const framed = Buffer.alloc(4 + sealed.length);
    framed.writeUInt32BE(sealed.length, 0);
    sealed.copy(framed, 4);
    push(framed);
  };
  const stream = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        seen += chunk.length;
        if (seen > plainLength) throw new Error('Library plaintext exceeds the declared length.');
        pending = Buffer.concat([pending, chunk]);
        while (pending.length > LIBRARY_CHUNK_SIZE) {
          emit(pending.subarray(0, LIBRARY_CHUNK_SIZE), false, (data) => this.push(data));
          pending = pending.subarray(LIBRARY_CHUNK_SIZE);
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (seen !== plainLength) throw new Error('Library plaintext is shorter than the declared length.');
        emit(pending, true, (data) => this.push(data));
        pending = Buffer.alloc(0);
        key.fill(0);
        callback();
      } catch (error) {
        key.fill(0);
        callback(error as Error);
      }
    },
  });
  return { stream, headerChunk };
}

export function createLibraryDecryptionStream(contentKey: Buffer, expectedFileId: string): Transform {
  let buffered = Buffer.alloc(0);
  let header: LibraryContainerHeader | null = null;
  let key: Buffer | null = null;
  let baseNonce: Buffer | null = null;
  let dataOffset = 0;
  let index = 0;
  let produced = 0;
  let sawFinal = false;
  const fail = (callback: TransformCallback, error: Error) => {
    key?.fill(0);
    callback(error);
  };
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        if (!header) {
          if (buffered.length < 12) return callback();
          const headerLength = buffered.readUInt32BE(8);
          if (headerLength === 0 || headerLength > MAX_HEADER_BYTES)
            throw new Error('Library container header is malformed.');
          if (buffered.length < 12 + headerLength) return callback();
          const parsed = parseLibraryContainerHeader(buffered);
          header = parsed.header;
          if (header.fileId !== expectedFileId) throw new Error('Library container belongs to a different file.');
          key = fileKey(contentKey, header.fileId);
          baseNonce = Buffer.from(header.baseNonce, 'base64');
          dataOffset = parsed.offset;
          buffered = buffered.subarray(dataOffset);
        }
        for (;;) {
          if (buffered.length < 4) break;
          const sealedLength = buffered.readUInt32BE(0);
          if (sealedLength < TAG_BYTES || sealedLength > LIBRARY_CHUNK_SIZE + TAG_BYTES)
            throw new Error('Library container chunk is malformed.');
          if (buffered.length < 4 + sealedLength) break;
          const sealed = buffered.subarray(4, 4 + sealedLength);
          buffered = buffered.subarray(4 + sealedLength);
          const remainingPlain = header!.plainLength - produced;
          const isFinalSize = sealedLength - TAG_BYTES === Math.min(remainingPlain, LIBRARY_CHUNK_SIZE) && remainingPlain <= LIBRARY_CHUNK_SIZE;
          const plain = decryptChunk(key!, header!.fileId, baseNonce!, index, sealed, isFinalSize);
          index += 1;
          produced += plain.length;
          if (produced > header!.plainLength) throw new Error('Library container exceeds the declared length.');
          if (isFinalSize) sawFinal = true;
          this.push(plain);
        }
        callback();
      } catch (error) {
        fail(callback, error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!header || !sawFinal || produced !== header.plainLength || buffered.length !== 0)
          throw new Error('Library container is truncated.');
        key?.fill(0);
        callback();
      } catch (error) {
        fail(callback, error as Error);
      }
    },
  });
}

/** Synchronous whole-buffer encryption (tests and small files). */
export function encryptLibraryFile(contentKey: Buffer, fileId: string, plaintext: Buffer): Buffer {
  const key = fileKey(contentKey, fileId);
  try {
    const baseNonce = randomBytes(NONCE_BYTES);
    const parts: Buffer[] = [
      headerBytes({
        version: 1,
        fileId,
        chunkSize: LIBRARY_CHUNK_SIZE,
        plainLength: plaintext.length,
        baseNonce: baseNonce.toString('base64'),
      }),
    ];
    let offset = 0;
    let index = 0;
    for (;;) {
      const end = Math.min(offset + LIBRARY_CHUNK_SIZE, plaintext.length);
      const final = end === plaintext.length;
      const sealed = encryptChunk(key, fileId, baseNonce, index, plaintext.subarray(offset, end), final);
      index += 1;
      const framed = Buffer.alloc(4 + sealed.length);
      framed.writeUInt32BE(sealed.length, 0);
      sealed.copy(framed, 4);
      parts.push(framed);
      offset = end;
      if (final) break;
    }
    return Buffer.concat(parts);
  } finally {
    key.fill(0);
  }
}

/** Synchronous whole-buffer decryption with full authentication. */
export function decryptLibraryFile(contentKey: Buffer, expectedFileId: string, container: Buffer): Buffer {
  const { header, offset } = parseLibraryContainerHeader(container);
  if (header.fileId !== expectedFileId) throw new Error('Library container belongs to a different file.');
  const key = fileKey(contentKey, header.fileId);
  try {
    const baseNonce = Buffer.from(header.baseNonce, 'base64');
    const parts: Buffer[] = [];
    let position = offset;
    let index = 0;
    let produced = 0;
    for (;;) {
      if (position + 4 > container.length) throw new Error('Library container is truncated.');
      const sealedLength = container.readUInt32BE(position);
      if (sealedLength < TAG_BYTES || sealedLength > LIBRARY_CHUNK_SIZE + TAG_BYTES)
        throw new Error('Library container chunk is malformed.');
      if (position + 4 + sealedLength > container.length) throw new Error('Library container is truncated.');
      const sealed = container.subarray(position + 4, position + 4 + sealedLength);
      position += 4 + sealedLength;
      const remainingPlain = header.plainLength - produced;
      const final = remainingPlain <= LIBRARY_CHUNK_SIZE && sealedLength - TAG_BYTES === remainingPlain;
      const plain = decryptChunk(key, header.fileId, baseNonce, index, sealed, final);
      index += 1;
      produced += plain.length;
      parts.push(plain);
      if (final) break;
      if (produced >= header.plainLength) throw new Error('Library container exceeds the declared length.');
    }
    if (position !== container.length || produced !== header.plainLength)
      throw new Error('Library container is truncated or has trailing data.');
    return Buffer.concat(parts);
  } finally {
    key.fill(0);
  }
}

/** Generate a fresh file id for a library container. */
export function newLibraryFileId(): string {
  return randomUUID();
}
