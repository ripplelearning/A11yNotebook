import { constants } from 'node:fs';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { MetadataResolver } from './metadata';
import type { MetadataProtectionPointer, ProtectedStoreName } from '../../src/shared/metadata-protection';
import { decryptRecord, encryptRecord, updateMetadataProtection, type VaultSecurityConfig } from './security';

export const PROTECTED_METADATA_MAX_BYTES = 16 * 1024 * 1024;
const MAX_CONTAINER_BYTES = Math.ceil((PROTECTED_METADATA_MAX_BYTES * 4) / 3) + 4096;
const filename = (store: ProtectedStoreName, generation: string) => `protected-${store}-${generation}.json`;

export async function readBoundedMetadata(source: string, maxBytes = MAX_CONTAINER_BYTES) {
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Invalid protected metadata container.');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== stat.size) throw new Error('Protected metadata changed during its bounded read.');
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function writeProtectedSecurityConfig(
  resolver: MetadataResolver,
  config: VaultSecurityConfig,
  access: ProtectedMetadataAccess,
) {
  const destination = await resolver.resolveMetadata('security.json', true);
  const staging = await resolver.resolveMetadata('pending-protected-security.json', true);
  await unlink(staging).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  access.assertCurrent();
  const handle = await open(
    staging,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify(config), 'utf8');
    await handle.sync();
    await handle.close();
    await resolver.resolveMetadata('security.json', true);
    access.assertCurrent();
    await rename(staging, destination);
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(staging).catch(() => undefined);
  }
}

export interface ProtectedMetadataAccess {
  key: Buffer;
  assertCurrent: () => void;
}

/** Callers serialize with all security.json mutations. No decrypted content is cached. */
export function createProtectedMetadataStore(options: {
  resolver: MetadataResolver;
  getConfig: () => VaultSecurityConfig | null;
  access: () => ProtectedMetadataAccess;
  commitConfig: (config: VaultSecurityConfig, access: ProtectedMetadataAccess) => Promise<void>;
  readLegacy: () => Promise<unknown>;
}) {
  const { resolver, getConfig } = options;
  function pointer() {
    const config = getConfig();
    return config?.version === 3 ? config.metadataProtection : undefined;
  }
  async function collectOrphans() {
    const active = pointer();
    const directory = path.dirname(await resolver.resolveMetadata('security.json', true));
    for (const name of await readdir(directory)) {
      const match = /^protected-(annotations|checkpoints)-([\da-f-]{36})\.json$/.exec(name);
      if (!match) continue;
      const store = match[1] as ProtectedStoreName;
      if (active?.stores[store].generation === match[2]) continue;
      await unlink(await resolver.resolveMetadata(name, true));
    }
  }
  async function atomic(name: string, value: unknown, access: ProtectedMetadataAccess) {
    const destination = await resolver.resolveMetadata(name, true);
    const stagingName = name.startsWith('protected-annotations-')
      ? 'pending-protected-annotations.json'
      : 'pending-protected-checkpoints.json';
    const staging = await resolver.resolveMetadata(stagingName, true);
    access.assertCurrent();
    await unlink(staging).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const handle = await open(
      staging,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(value), 'utf8');
      await handle.sync();
      await handle.close();
      await resolver.resolveMetadata(name, true);
      access.assertCurrent();
      await rename(staging, destination);
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(staging).catch(() => undefined);
    }
  }
  async function stage(
    store: ProtectedStoreName,
    value: unknown,
    identity: MetadataProtectionPointer,
    access: ProtectedMetadataAccess,
  ) {
    const plaintext = JSON.stringify(value);
    if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > PROTECTED_METADATA_MAX_BYTES)
      throw new Error('Protected metadata exceeds the allowed size.');
    access.assertCurrent();
    const generation = identity.stores[store].generation;
    const record = encryptRecord(
      access.key,
      `metadata-${store}`,
      `${identity.vaultId}:${store}:${generation}`,
      plaintext,
    );
    const container = { version: 1, store, vaultId: identity.vaultId, generation, record };
    identity.stores[store].digest = createHash('sha256').update(JSON.stringify(container), 'utf8').digest('hex');
    await atomic(filename(store, generation), container, access);
  }
  async function commit(identity: MetadataProtectionPointer, access: ProtectedMetadataAccess) {
    access.assertCurrent();
    const config = getConfig();
    if (!config) throw new Error('Vault protection is unavailable.');
    await options.commitConfig(updateMetadataProtection(config, access.key, identity), access);
    access.assertCurrent();
  }
  async function read(store: ProtectedStoreName, cleaning = false): Promise<unknown> {
    const access = options.access();
    const identity = pointer();
    if (!identity) throw new Error('Encrypted metadata protection is not enabled.');
    if (!cleaning && Object.values(identity.stores).some((item) => item.cleanupRequired))
      throw new Error('Finish protected metadata cleanup before accessing content.');
    const source = await resolver.resolveMetadata(filename(store, identity.stores[store].generation));
    const bytes = await readBoundedMetadata(source);
    access.assertCurrent();
    if (createHash('sha256').update(bytes, 'utf8').digest('hex') !== identity.stores[store].digest)
      throw new Error('Protected metadata digest does not match its authenticated pointer.');
    const container = JSON.parse(bytes);
    const generation = identity.stores[store].generation;
    if (
      !container ||
      typeof container !== 'object' ||
      Array.isArray(container) ||
      Object.keys(container).sort().join(',') !== 'generation,record,store,vaultId,version' ||
      container.version !== 1 ||
      container.store !== store ||
      container.vaultId !== identity.vaultId ||
      container.generation !== generation ||
      container.record?.id !== `${identity.vaultId}:${store}:${generation}`
    )
      throw new Error('Invalid protected metadata container.');
    const plaintext = decryptRecord(access.key, `metadata-${store}`, container.record);
    if (Buffer.byteLength(plaintext) > PROTECTED_METADATA_MAX_BYTES)
      throw new Error('Invalid protected metadata size.');
    const result: unknown = JSON.parse(plaintext);
    access.assertCurrent();
    return result;
  }
  async function finishCleanup() {
    const identity = pointer();
    if (!identity || !Object.values(identity.stores).some((item) => item.cleanupRequired)) return;
    const access = options.access();
    await read('annotations', true);
    await read('checkpoints', true);
    access.assertCurrent();
    // The authenticated pointer is authoritative even when plaintext removal was interrupted.
    for (const store of ['annotations', 'checkpoints'] as const) {
      if (!identity.stores[store].cleanupRequired) continue;
      const source = await resolver.resolveMetadata(`${store}.json`, true);
      access.assertCurrent();
      await unlink(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      access.assertCurrent();
    }
    await commit(
      {
        ...identity,
        stores: {
          annotations: { ...identity.stores.annotations, cleanupRequired: false },
          checkpoints: { ...identity.stores.checkpoints, cleanupRequired: false },
        },
      },
      access,
    );
  }
  return {
    enabled: () => pointer() !== undefined,
    read: (store: ProtectedStoreName) => read(store),
    async write(store: ProtectedStoreName, value: unknown, authorize: () => void = () => undefined) {
      const captured = options.access();
      const access: ProtectedMetadataAccess = {
        key: captured.key,
        assertCurrent: () => {
          captured.assertCurrent();
          authorize();
        },
      };
      access.assertCurrent();
      const previous = pointer();
      if (!previous || Object.values(previous.stores).some((item) => item.cleanupRequired))
        throw new Error('Encrypted metadata protection is unavailable.');
      await read(store);
      await collectOrphans();
      access.assertCurrent();
      const next = {
        ...previous,
        stores: { ...previous.stores, [store]: { generation: randomUUID(), digest: '', cleanupRequired: false } },
      };
      await stage(store, value, next, access);
      await commit(next, access);
      await unlink(await resolver.resolveMetadata(filename(store, previous.stores[store].generation), true)).catch(
        () => undefined,
      );
    },
    async enable() {
      const access = options.access();
      if (pointer()) throw new Error('Encrypted metadata protection is already enabled.');
      if (getConfig()?.version !== 3) throw new Error('Enable vault recovery and unlock a version-3 vault first.');
      await collectOrphans();
      const directory = path.dirname(await resolver.resolveMetadata('security.json', true));
      if (
        (await readdir(directory)).some((name) =>
          /^(?:pending-[\da-f-]{36}|pending-annotations[^/]*)\.json$/i.test(name),
        )
      ) {
        throw new Error('Uncommitted legacy metadata staging exists. Resolve it before enabling protection.');
      }
      const existingCheckpoints = await resolver.resolveMetadata('checkpoints.json', true);
      const checkpointsStat = await lstat(existingCheckpoints).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (checkpointsStat) throw new Error('Unexpected plaintext checkpoints exist; protection was not enabled.');
      const legacy = await options.readLegacy();
      access.assertCurrent();
      const identity: MetadataProtectionPointer = {
        version: 1,
        vaultId: randomUUID(),
        stores: {
          annotations: { generation: randomUUID(), digest: '', cleanupRequired: true },
          checkpoints: { generation: randomUUID(), digest: '', cleanupRequired: true },
        },
      };
      await stage('annotations', legacy ?? { version: 2, annotations: [], pdfAnnotations: [] }, identity, access);
      await stage('checkpoints', { version: 1, drafts: [] }, identity, access);
      await commit(identity, access);
      await finishCleanup();
    },
    finishCleanup,
  };
}
