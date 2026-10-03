import { randomUUID } from 'node:crypto';
import {
  ANNOTATION_COLORS,
  ANNOTATION_LIMITS,
  type AnnotationAnchor,
  type AnnotationUpdate,
  type NewAnnotation,
  type NoteAnnotation,
} from '../../src/shared/annotations';

export interface AnnotationStoreOptions {
  read: () => Promise<unknown>;
  write: (value: AnnotationMetadata) => Promise<void>;
  validateNote: (path: string) => Promise<void>;
}

export interface AnnotationMetadata {
  version: 1;
  annotations: NoteAnnotation[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid annotation.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error('Invalid annotation text.');
  }
  return value;
}

function notePath(value: unknown): string {
  const path = text(value, 4096, true);
  if (
    path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) throw new Error('Invalid annotation note path.');
  return path;
}

function anchor(value: unknown): AnnotationAnchor {
  const data = object(value);
  const quote = text(data.quote, ANNOTATION_LIMITS.quote, true);
  if (
    !Number.isSafeInteger(data.start) || !Number.isSafeInteger(data.end) ||
    (data.start as number) < 0 || (data.end as number) - (data.start as number) !== quote.length
  ) throw new Error('Invalid annotation offsets.');
  return {
    quote,
    prefix: text(data.prefix, ANNOTATION_LIMITS.context),
    suffix: text(data.suffix, ANNOTATION_LIMITS.context),
    start: data.start as number,
    end: data.end as number,
  };
}

function fields(value: unknown): Pick<NoteAnnotation, 'color' | 'label' | 'comment'> {
  const data = object(value);
  if (!ANNOTATION_COLORS.includes(data.color as NoteAnnotation['color'])) throw new Error('Invalid annotation color.');
  return {
    color: data.color as NoteAnnotation['color'],
    label: text(data.label, ANNOTATION_LIMITS.label, true),
    comment: text(data.comment, ANNOTATION_LIMITS.comment),
  };
}

function record(value: unknown): NoteAnnotation {
  const data = object(value);
  const id = text(data.id, 36, true);
  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) {
    throw new Error('Invalid annotation identifier.');
  }
  const createdAt = text(data.createdAt, 30, true);
  const updatedAt = text(data.updatedAt, 30, true);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('Invalid annotation date.');
  }
  return { id, path: notePath(data.path), anchor: anchor(data.anchor), ...fields(data), createdAt, updatedAt };
}

/** Callbacks must securely read/write vault-local metadata and reject notes outside the vault, including symlinks. */
export function createAnnotationStore({ read, write, validateNote }: AnnotationStoreOptions) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }
  async function load(): Promise<AnnotationMetadata> {
    const raw = await read();
    if (raw === undefined || raw === null) return { version: 1, annotations: [] };
    const data = object(raw);
    if (data.version !== 1 || !Array.isArray(data.annotations) || data.annotations.length > ANNOTATION_LIMITS.records) {
      throw new Error('Invalid annotation metadata.');
    }
    const annotations = data.annotations.map(record);
    if (new Set(annotations.map((item) => item.id)).size !== annotations.length) {
      throw new Error('Duplicate annotation identifier.');
    }
    return { version: 1, annotations };
  }
  async function validate(path: unknown) {
    const safe = notePath(path);
    if (!safe.toLowerCase().endsWith('.md')) throw new Error('Annotations require a Markdown note.');
    await validateNote(safe);
    return safe;
  }
  return {
    list(path: string): Promise<NoteAnnotation[]> {
      return serial(async () => {
        const safe = await validate(path);
        return (await load()).annotations.filter((item) => item.path === safe);
      });
    },
    add(input: NewAnnotation): Promise<NoteAnnotation> {
      return serial(async () => {
        const data = object(input);
        const path = await validate(data.path);
        const validAnchor = anchor(data.anchor);
        const validFields = fields(data);
        const metadata = await load();
        if (metadata.annotations.length >= ANNOTATION_LIMITS.records) throw new Error('Annotation limit reached.');
        const now = new Date().toISOString();
        const added: NoteAnnotation = {
          id: randomUUID(), path, anchor: validAnchor, ...validFields, createdAt: now, updatedAt: now,
        };
        metadata.annotations.push(added);
        await write(metadata);
        return added;
      });
    },
    update(path: string, id: string, patch: AnnotationUpdate): Promise<NoteAnnotation> {
      return serial(async () => {
        const safe = await validate(path);
        const data = object(patch);
        if (Object.keys(data).some((key) => !['color', 'label', 'comment'].includes(key))) {
          throw new Error('Invalid annotation update.');
        }
        const metadata = await load();
        const index = metadata.annotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('Annotation not found.');
        const updated = {
          ...metadata.annotations[index],
          ...fields({ ...metadata.annotations[index], ...data }),
          updatedAt: new Date().toISOString(),
        };
        metadata.annotations[index] = updated;
        await write(metadata);
        return updated;
      });
    },
    delete(path: string, id: string): Promise<void> {
      return serial(async () => {
        const safe = await validate(path);
        const metadata = await load();
        const index = metadata.annotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('Annotation not found.');
        metadata.annotations.splice(index, 1);
        await write(metadata);
      });
    },
    migratePaths(from: string, to: string): Promise<void> {
      return serial(async () => {
        const source = notePath(from);
        const destination = notePath(to);
        const metadata = await load();
        for (const item of metadata.annotations) {
          if (item.path === source || item.path.startsWith(`${source}/`)) {
            item.path = await validate(`${destination}${item.path.slice(source.length)}`);
          }
        }
        await write(metadata);
      });
    },
  };
}
