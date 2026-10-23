import { randomBytes, randomUUID } from 'node:crypto';
import { decryptRecord, encryptRecord, type EncryptedRecord } from './security';

/**
 * Whole-library encryption manifest.
 *
 * The manifest is the migration's source of truth and lives as a
 * metadata file of its own (library-encryption.json), deliberately
 * outside security.json so the version-3 config does not change. It
 * carries a random library content key wrapped by the vault data
 * key (an authenticated record, domain 'library-content'), the
 * migration state, and the per-file container index. The files map
 * is not itself authenticated, so every container read is verified
 * against the manifest's fileId for that path AND the container's
 * authenticated chunks — a spliced or renamed container fails.
 *
 * States: 'migrating' (some files may still be plaintext; resumable
 * after a crash by re-running the migration over unlisted files) and
 * 'active' (every listed path is a container; reads fail closed for
 * listed paths that are not valid containers).
 */
export interface LibraryManifestFile {
  fileId: string;
  plainLength: number;
  containerLength: number;
}

export interface LibraryEncryptionManifest {
  version: 1;
  state: 'migrating' | 'active';
  wrappedContentKey: EncryptedRecord;
  files: Record<string, LibraryManifestFile>;
}

const MAX_MANIFEST_FILES = 100_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createLibraryEncryptionManifest(dataKey: Buffer): {
  manifest: LibraryEncryptionManifest;
  contentKey: Buffer;
} {
  const contentKey = randomBytes(32);
  try {
    const wrappedContentKey = encryptRecord(
      dataKey,
      'library-content',
      'library-content-key',
      contentKey.toString('base64'),
    );
    return {
      manifest: { version: 1, state: 'migrating', wrappedContentKey, files: {} },
      contentKey,
    };
  } catch (error) {
    contentKey.fill(0);
    throw error;
  }
}

export function openLibraryContentKey(dataKey: Buffer, manifest: LibraryEncryptionManifest): Buffer {
  const encoded = decryptRecord(dataKey, 'library-content', manifest.wrappedContentKey);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    key.fill(0);
    throw new Error('Library content key is malformed.');
  }
  return key;
}

export function validateLibraryEncryptionManifest(value: unknown): asserts value is LibraryEncryptionManifest {
  const fail = () => {
    throw new Error('Library encryption manifest is malformed.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const manifest = value as LibraryEncryptionManifest;
  if (
    manifest.version !== 1 ||
    (manifest.state !== 'migrating' && manifest.state !== 'active') ||
    !manifest.wrappedContentKey ||
    typeof manifest.wrappedContentKey !== 'object' ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files)
  )
    fail();
  const entries = Object.entries(manifest.files);
  if (entries.length > MAX_MANIFEST_FILES) fail();
  for (const [relative, file] of entries) {
    if (
      typeof relative !== 'string' ||
      relative.length === 0 ||
      relative.length > 1024 ||
      relative.includes('\\') ||
      relative.split('/').some((part) => part === '' || part === '.' || part === '..') ||
      !file ||
      typeof file !== 'object' ||
      typeof file.fileId !== 'string' ||
      !UUID_PATTERN.test(file.fileId) ||
      !Number.isSafeInteger(file.plainLength) ||
      file.plainLength < 0 ||
      !Number.isSafeInteger(file.containerLength) ||
      file.containerLength < 0
    )
      fail();
  }
}

export function newManifestFileId(): string {
  return randomUUID();
}
