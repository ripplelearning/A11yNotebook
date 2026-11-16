import {
  PDF_FORM_SCHEMA_VERSION,
  PDF_FORM_VALUE_LIMITS,
  type PdfFormValues,
  type PdfFormValuesRecord,
} from '../../src/shared/pdf-form';

export interface PdfFormValueStoreOptions {
  read: () => Promise<unknown>;
  write: (value: PdfFormValuesMetadata) => Promise<void>;
  validatePdf: (path: string) => Promise<void>;
  captureAuthorization?: () => () => void;
}

export interface PdfFormValuesMetadata {
  version: 1;
  records: PdfFormValuesRecord[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid filled form values.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error('Invalid filled form value.');
  }
  return value;
}

function formPath(value: unknown): string {
  const path = text(value, 4096, true);
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid filled form document path.');
  return path;
}

function values(value: unknown): PdfFormValues {
  const data = object(value);
  const entries = Object.entries(data);
  if (entries.length > PDF_FORM_VALUE_LIMITS.fields) throw new Error('Too many filled form fields.');
  const cleaned: PdfFormValues = {};
  for (const [name, stored] of entries) {
    if (typeof name !== 'string' || !name || name.length > PDF_FORM_VALUE_LIMITS.fieldName) {
      throw new Error('Invalid filled form field name.');
    }
    if (typeof stored === 'boolean') cleaned[name] = stored;
    else if (typeof stored === 'string' && stored.length <= PDF_FORM_VALUE_LIMITS.textValue) cleaned[name] = stored;
    else throw new Error('Invalid filled form value.');
  }
  return cleaned;
}

function record(value: unknown): PdfFormValuesRecord {
  const data = object(value);
  const path = formPath(data.path);
  const identity = object(data.documentIdentity);
  const fingerprint = text(identity.fingerprint, 4096);
  const fileHash = text(identity.fileHash, 4096);
  if (identity.vaultPath !== path || (!fingerprint && !fileHash)) {
    throw new Error('Invalid filled form document identity.');
  }
  const updatedAt = text(data.updatedAt, 30, true);
  if (data.schemaVersion !== PDF_FORM_SCHEMA_VERSION || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('Invalid filled form record.');
  }
  if (!/\.pdf(\.alius)?$/i.test(path)) throw new Error('Filled form values require a PDF document.');
  return {
    path,
    documentIdentity: { fingerprint, fileHash, vaultPath: path },
    values: values(data.values),
    updatedAt,
    schemaVersion: PDF_FORM_SCHEMA_VERSION,
  };
}

export interface PdfFormValueStore {
  get(path: string): Promise<PdfFormValues>;
  save(
    path: string,
    values: PdfFormValues,
    identity: PdfFormValuesRecord['documentIdentity'],
  ): Promise<PdfFormValuesRecord>;
  migratePaths(from: string, to: string): Promise<void>;
}

/** Callbacks must securely read/write library-local metadata and reject paths outside the library. */
export function createPdfFormValueStore({
  read,
  write: persist,
  validatePdf,
  captureAuthorization,
}: PdfFormValueStoreOptions): PdfFormValueStore {
  let queue: Promise<unknown> = Promise.resolve();
  let activeAuthorization: (() => void) | undefined;
  async function write(value: PdfFormValuesMetadata) {
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
  async function load(): Promise<PdfFormValuesMetadata> {
    const raw = await read();
    activeAuthorization?.();
    if (raw === undefined || raw === null) return { version: 1, records: [] };
    const data = object(raw);
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > PDF_FORM_VALUE_LIMITS.records) {
      throw new Error('Invalid filled form metadata.');
    }
    return { version: 1, records: (data.records as unknown[]).map(record) };
  }
  return {
    get(path) {
      return serial(async () => {
        const safe = formPath(path);
        await validatePdf(safe);
        const found = (await load()).records.find((item) => item.path === safe);
        return found ? found.values : {};
      });
    },
    save(path, input, identity) {
      return serial(async () => {
        const safe = formPath(path);
        await validatePdf(safe);
        if (identity.vaultPath !== safe) throw new Error('Filled form document identity does not match the document.');
        const clean = values(input);
        const metadata = await load();
        const now = new Date().toISOString();
        const existing = metadata.records.findIndex((item) => item.path === safe);
        const saved: PdfFormValuesRecord = {
          path: safe,
          documentIdentity: {
            fingerprint: text(identity.fingerprint, 4096),
            fileHash: text(identity.fileHash, 4096),
            vaultPath: safe,
          },
          values: clean,
          updatedAt: now,
          schemaVersion: PDF_FORM_SCHEMA_VERSION,
        };
        if (existing >= 0) metadata.records[existing] = saved;
        else {
          if (metadata.records.length >= PDF_FORM_VALUE_LIMITS.records) {
            throw new Error('Filled form record limit reached.');
          }
          metadata.records.push(saved);
        }
        await write(metadata);
        return saved;
      });
    },
    migratePaths(from, to) {
      return serial(async () => {
        const source = formPath(from);
        const destination = formPath(to);
        const metadata = await load();
        for (const item of metadata.records) {
          if (item.path === source || item.path.startsWith(`${source}/`)) {
            item.path = formPath(`${destination}${item.path.slice(source.length)}`);
            item.documentIdentity.vaultPath = item.path;
          }
        }
        await write(metadata);
      });
    },
  };
}
