import { createHash, randomUUID } from 'node:crypto';
import {
  ASSET_DRAFT_MAX_BYTES,
  ASSET_DRAFT_MAX_RECORDS,
  ASSET_DRAFT_RETENTION_MS,
  type AssetDraft,
  type AssetDraftInput,
} from '../../src/shared/asset-drafts';
import { assetTypes, createAssetRegistry } from '../../src/shared/assets';

export interface ProtectedDraftStorage {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

const registry = createAssetRegistry(assetTypes);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function validatePath(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !value ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.includes('\0') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    /^[a-z]:/i.test(value)
  )
    throw new Error('Invalid draft path.');
}
function validateInput(value: unknown): AssetDraftInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid asset draft.');
  const data = value as AssetDraftInput;
  validatePath(data.path);
  const type = registry.resolve(data.path);
  if (
    !type ||
    data.type !== type.id ||
    typeof data.content !== 'string' ||
    typeof data.baselineContent !== 'string' ||
    Buffer.byteLength(data.content) > ASSET_DRAFT_MAX_BYTES ||
    Buffer.byteLength(data.baselineContent) > ASSET_DRAFT_MAX_BYTES
  )
    throw new Error('Invalid asset draft content.');
  type.parse(data.baselineContent);
  // Incomplete source edits (such as a half-written flashcard) are recoverable too.
  return { path: data.path, type: data.type, content: data.content, baselineContent: data.baselineContent };
}
function validateRecords(raw: unknown): AssetDraft[] {
  if (raw === null) return [];
  if (Buffer.byteLength(JSON.stringify(raw)) > 8 * 1024 * 1024)
    throw new Error('Encrypted draft storage exceeds its size limit.');
  const container = raw as { version?: unknown; drafts?: unknown };
  if (
    !container ||
    container.version !== 1 ||
    !Array.isArray(container.drafts) ||
    Object.keys(container).some((key) => !['version', 'drafts'].includes(key)) ||
    container.drafts.length > ASSET_DRAFT_MAX_RECORDS
  )
    throw new Error('Invalid encrypted draft schema.');
  const seen = new Set<string>();
  return container.drafts.map((value: AssetDraft) => {
    const input = validateInput(value);
    if (
      Object.keys(value).sort().join(',') !==
        'baselineContent,baselineHash,content,expiresAt,path,revision,type,updatedAt' ||
      typeof value.revision !== 'string' ||
      !/^[\da-f-]{36}$/.test(value.revision) ||
      typeof value.updatedAt !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      new Date(value.updatedAt).toISOString() !== value.updatedAt ||
      new Date(value.expiresAt).toISOString() !== value.expiresAt ||
      Date.parse(value.expiresAt) - Date.parse(value.updatedAt) !== ASSET_DRAFT_RETENTION_MS ||
      value.baselineHash !== hash(input.baselineContent) ||
      seen.has(value.path)
    )
      throw new Error('Invalid encrypted draft record.');
    seen.add(value.path);
    return {
      ...input,
      revision: value.revision,
      updatedAt: value.updatedAt,
      expiresAt: value.expiresAt,
      baselineHash: value.baselineHash,
    };
  });
}

/** Storage must be the opted-in authenticated ciphertext store, never generic metadata. */
export function createAssetDraftStore(storage: ProtectedDraftStorage, now = () => Date.now()) {
  async function records() {
    const all = validateRecords(await storage.read());
    const retained = all.filter((draft) => Date.parse(draft.expiresAt) > now() && Date.parse(draft.updatedAt) <= now());
    if (retained.length !== all.length) await write(retained);
    return retained;
  }
  async function write(drafts: AssetDraft[]) {
    const value = { version: 1, drafts };
    if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new Error('Encrypted draft storage is full.');
    await storage.write(value);
  }
  return {
    read: async (relative: string) => {
      validatePath(relative);
      return (await records()).find((draft) => draft.path === relative) ?? null;
    },
    checkpoint: async (value: unknown) => {
      const input = validateInput(value);
      const all = (await records()).filter((draft) => draft.path !== input.path);
      const draft: AssetDraft = {
        ...input,
        revision: randomUUID(),
        updatedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + ASSET_DRAFT_RETENTION_MS).toISOString(),
        baselineHash: hash(input.baselineContent),
      };
      if (all.length >= ASSET_DRAFT_MAX_RECORDS)
        throw new Error('Encrypted draft storage is full. Discard an older draft first.');
      await write([...all, draft]);
      return draft;
    },
    discard: async (relative: string, revision: string) => {
      validatePath(relative);
      const all = await records();
      await write(all.filter((draft) => draft.path !== relative || draft.revision !== revision));
    },
    deletePaths: async (relative: string) => {
      validatePath(relative);
      await write(
        (await records()).filter((draft) => draft.path !== relative && !draft.path.startsWith(`${relative}/`)),
      );
    },
    migratePaths: async (before: string, after: string) => {
      validatePath(before);
      validatePath(after);
      const all = await records();
      const migrated = all.map((draft) =>
        draft.path === before || draft.path.startsWith(`${before}/`)
          ? { ...draft, path: after + draft.path.slice(before.length) }
          : draft,
      );
      validateRecords({ version: 1, drafts: migrated });
      await write(migrated);
    },
  };
}
