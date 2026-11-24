/**
 * Template links: which template a filled note was made from, so its
 * reading view can offer a fresh fillable copy from that same template.
 *
 * Stored in the app's library metadata (template-links.json), keyed by
 * the filled note's library path — the same sidecar pattern as filled
 * PDF form values (pdf-form-values.json), never written into the note
 * file itself. migratePaths is called from the same rename/move flow
 * as the note-link repair, and it retargets both sides of the link: the
 * filled note's own path when it moves, and the template's path when
 * the template is renamed or moved. A link whose template is gone
 * simply has no file to resolve to; the reader reports that.
 */
import {
  TEMPLATE_LINK_LIMITS,
  TEMPLATE_LINK_SCHEMA_VERSION,
  type TemplateLinkRecord,
} from '../../src/shared/template-fields';

export interface TemplateLinkStoreOptions {
  read: () => Promise<unknown>;
  write: (value: TemplateLinksMetadata) => Promise<void>;
  validateNote: (path: string) => Promise<void>;
  captureAuthorization?: () => () => void;
}

export interface TemplateLinksMetadata {
  version: 1;
  records: TemplateLinkRecord[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid template link metadata.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error('Invalid template link value.');
  }
  return value;
}

function linkPath(value: unknown): string {
  const path = text(value, 4096, true);
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid template link path.');
  return path;
}

function record(value: unknown): TemplateLinkRecord {
  const data = object(value);
  const path = linkPath(data.path);
  const templatePath = linkPath(data.templatePath);
  const updatedAt = text(data.updatedAt, 30, true);
  if (data.schemaVersion !== TEMPLATE_LINK_SCHEMA_VERSION || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('Invalid template link record.');
  }
  return { path, templatePath, updatedAt, schemaVersion: TEMPLATE_LINK_SCHEMA_VERSION };
}

export interface TemplateLinkStore {
  get(path: string): Promise<string | null>;
  save(path: string, templatePath: string | null): Promise<TemplateLinkRecord | null>;
  migratePaths(from: string, to: string): Promise<void>;
}

/** Callbacks must securely read/write library-local metadata and reject paths outside the library. */
export function createTemplateLinkStore({
  read,
  write: persist,
  validateNote,
  captureAuthorization,
}: TemplateLinkStoreOptions): TemplateLinkStore {
  let queue: Promise<unknown> = Promise.resolve();
  let activeAuthorization: (() => void) | undefined;
  async function write(value: TemplateLinksMetadata) {
    activeAuthorization?.();
    await persist(value);
    activeAuthorization?.();
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const authorize = captureAuthorization?.();
    const result = queue.then(async () => {
      authorize?.();
      activeAuthorization = authorize;
      const value = await operation();
      authorize?.();
      return value;
    });
    queue = result.catch(() => undefined);
    return result;
  }
  async function load(): Promise<TemplateLinksMetadata> {
    const raw = await read();
    activeAuthorization?.();
    if (raw === undefined || raw === null) return { version: 1, records: [] };
    const data = object(raw);
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > TEMPLATE_LINK_LIMITS.records) {
      throw new Error('Invalid template link metadata.');
    }
    return { version: 1, records: (data.records as unknown[]).map(record) };
  }
  function remap(value: string, from: string, to: string): string {
    return value === from || value.startsWith(`${from}/`) ? to + value.slice(from.length) : value;
  }
  return {
    get(path) {
      return serial(async () => {
        const safe = linkPath(path);
        await validateNote(safe);
        const found = (await load()).records.find((item) => item.path === safe);
        return found ? found.templatePath : null;
      });
    },
    save(path, templatePath) {
      return serial(async () => {
        const safe = linkPath(path);
        await validateNote(safe);
        const metadata = await load();
        const existing = metadata.records.findIndex((item) => item.path === safe);
        if (templatePath === null) {
          if (existing >= 0) {
            metadata.records.splice(existing, 1);
            await write(metadata);
          }
          return null;
        }
        const target = linkPath(templatePath);
        await validateNote(target);
        const saved: TemplateLinkRecord = {
          path: safe,
          templatePath: target,
          updatedAt: new Date().toISOString(),
          schemaVersion: TEMPLATE_LINK_SCHEMA_VERSION,
        };
        if (existing >= 0) metadata.records[existing] = saved;
        else {
          if (metadata.records.length >= TEMPLATE_LINK_LIMITS.records) {
            throw new Error('Template link limit reached.');
          }
          metadata.records.push(saved);
        }
        await write(metadata);
        return saved;
      });
    },
    migratePaths(from, to) {
      return serial(async () => {
        const source = linkPath(from);
        const destination = linkPath(to);
        const metadata = await load();
        for (const item of metadata.records) {
          item.path = remap(item.path, source, destination);
          item.templatePath = remap(item.templatePath, source, destination);
        }
        await write(metadata);
      });
    },
  };
}
