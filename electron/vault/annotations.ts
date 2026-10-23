import { randomUUID } from 'node:crypto';
import {
  ANNOTATION_COLORS,
  ANNOTATION_LIMITS,
  type AnnotationAnchor,
  type AnnotationUpdate,
  type NewAnnotation,
  type NoteAnnotation,
} from '../../src/shared/annotations';
import type { DocxAnnotationStore, EpubAnnotationStore, PdfAnnotationStore } from '../../src/shared/annotation-store';
import {
  DOCX_ANNOTATION_LIMITS,
  DOCX_ANNOTATION_SCHEMA_VERSION,
  type DocxAnnotation,
  type DocxAnnotationAnchor,
} from '../../src/shared/docx-annotations';
import {
  EPUB_ANNOTATION_LIMITS,
  EPUB_ANNOTATION_SCHEMA_VERSION,
  type EpubAnnotation,
  type EpubAnnotationAnchor,
} from '../../src/shared/epub-annotations';
import {
  PDF_ANNOTATION_COLORS,
  PDF_ANNOTATION_LIMITS,
  PDF_ANNOTATION_SCHEMA_VERSION,
  PDF_MALFORMED_TARGET_REASON,
  PDF_MALFORMED_GROUPED_TARGET_REASON,
  type PdfAnnotation,
  type PdfAnnotationTarget,
} from '../../src/shared/pdf-annotation';

export interface AnnotationStoreOptions {
  read: () => Promise<unknown>;
  write: (value: AnnotationMetadata) => Promise<void>;
  validateNote: (path: string) => Promise<void>;
  validatePdf?: (path: string) => Promise<void>;
  validateDocx?: (path: string) => Promise<void>;
  validateEpub?: (path: string) => Promise<void>;
  captureAuthorization?: () => () => void;
}

export interface AnnotationMetadata {
  version: 4;
  annotations: NoteAnnotation[];
  pdfAnnotations: PdfAnnotation[];
  docxAnnotations: DocxAnnotation[];
  epubAnnotations: EpubAnnotation[];
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
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid annotation note path.');
  return path;
}

function anchor(value: unknown): AnnotationAnchor {
  const data = object(value);
  const quote = text(data.quote, ANNOTATION_LIMITS.quote, true);
  if (
    !Number.isSafeInteger(data.start) ||
    !Number.isSafeInteger(data.end) ||
    (data.start as number) < 0 ||
    (data.end as number) - (data.start as number) !== quote.length
  )
    throw new Error('Invalid annotation offsets.');
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

function pdfTarget(value: unknown, path: string): PdfAnnotationTarget {
  const data = object(value);
  const identity = object(data.documentIdentity);
  const fingerprint = text(identity.fingerprint, 4096);
  const fileHash = text(identity.fileHash, 4096);
  if (
    data.kind !== 'pdf' ||
    notePath(identity.vaultPath) !== path ||
    (!fingerprint && !fileHash) ||
    !Number.isSafeInteger(data.page) ||
    (data.page as number) < 1 ||
    !Number.isSafeInteger(data.canonicalStart) ||
    (data.canonicalStart as number) < 0 ||
    !Number.isSafeInteger(data.canonicalLength) ||
    (data.canonicalLength as number) < 1 ||
    !Number.isSafeInteger((data.canonicalStart as number) + (data.canonicalLength as number)) ||
    typeof data.classification !== 'string' ||
    !['exact', 'context-disambiguated', 'normalized', 'ambiguous', 'orphan'].includes(data.classification) ||
    typeof data.confidence !== 'string' ||
    !['certain', 'probable', 'uncertain'].includes(data.confidence) ||
    (data.verification !== undefined &&
      (typeof data.verification !== 'string' || !['verified', 'unverified'].includes(data.verification))) ||
    (data.manuallyConfirmed !== undefined && typeof data.manuallyConfirmed !== 'boolean')
  )
    throw new Error('Invalid PDF annotation target.');
  return {
    kind: 'pdf',
    documentIdentity: { fingerprint, fileHash, vaultPath: path },
    page: data.page as number,
    canonicalStart: data.canonicalStart as number,
    canonicalLength: data.canonicalLength as number,
    exactQuote: text(data.exactQuote, PDF_ANNOTATION_LIMITS.quote, true),
    normalizedQuote: text(data.normalizedQuote, PDF_ANNOTATION_LIMITS.quote, true),
    contextBefore: text(data.contextBefore, PDF_ANNOTATION_LIMITS.context),
    contextAfter: text(data.contextAfter, PDF_ANNOTATION_LIMITS.context),
    classification: data.classification as PdfAnnotationTarget['classification'],
    confidence: data.confidence as PdfAnnotationTarget['confidence'],
    ...(data.structPath !== undefined ? { structPath: text(data.structPath, 4096) } : {}),
    ...(data.verification !== undefined
      ? { verification: data.verification as PdfAnnotationTarget['verification'] }
      : {}),
    manuallyConfirmed: data.manuallyConfirmed === true,
    ...(data.reason !== undefined ? { reason: text(data.reason, PDF_ANNOTATION_LIMITS.reason) } : {}),
  };
}

function loadedPdfTarget(value: unknown, path: string): PdfAnnotationTarget {
  try {
    const data = object(value);
    if (data.manuallyConfirmed !== undefined && typeof data.manuallyConfirmed !== 'boolean')
      throw new Error('Invalid PDF annotation confirmation.');
    const inferred = data.classification === undefined || data.confidence === undefined;
    return pdfTarget(
      {
        ...data,
        classification: data.classification === undefined ? 'exact' : data.classification,
        confidence: data.confidence === undefined ? 'probable' : data.confidence,
        manuallyConfirmed: inferred || data.manuallyConfirmed === undefined ? false : data.manuallyConfirmed,
        ...(inferred
          ? {
              verification: 'unverified',
              manuallyConfirmed: false,
              reason:
                data.reason === undefined
                  ? 'Stored PDF target classification was inferred; verify against the document.'
                  : data.reason,
            }
          : {}),
      },
      path,
    );
  } catch {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? object(value) : {};
    const identity =
      data.documentIdentity && typeof data.documentIdentity === 'object' && !Array.isArray(data.documentIdentity)
        ? object(data.documentIdentity)
        : {};
    const safeText = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
    const exactQuote = safeText(data.exactQuote, PDF_ANNOTATION_LIMITS.quote);
    return {
      kind: 'pdf',
      documentIdentity: {
        fingerprint: safeText(identity.fingerprint, 4096),
        fileHash: safeText(identity.fileHash, 4096),
        vaultPath: path,
      },
      page: Number.isSafeInteger(data.page) && (data.page as number) > 0 ? (data.page as number) : 1,
      canonicalStart: 0,
      canonicalLength: exactQuote.length,
      exactQuote,
      normalizedQuote: safeText(data.normalizedQuote, PDF_ANNOTATION_LIMITS.quote),
      contextBefore: safeText(data.contextBefore, PDF_ANNOTATION_LIMITS.context),
      contextAfter: safeText(data.contextAfter, PDF_ANNOTATION_LIMITS.context),
      classification: 'orphan',
      confidence: 'uncertain',
      verification: 'unverified',
      manuallyConfirmed: false,
      reason:
        typeof data.reason === 'string' &&
        /^(?:Stored PDF target|Stored grouped PDF target) was malformed/.test(data.reason)
          ? safeText(data.reason, PDF_ANNOTATION_LIMITS.reason)
          : PDF_MALFORMED_TARGET_REASON,
    };
  }
}

function pdfTargets(value: unknown, path: string, loaded = false): PdfAnnotationTarget[] | undefined {
  if (value === undefined) return undefined;
  if (loaded && !Array.isArray(value))
    return [
      {
        ...loadedPdfTarget(value, path),
        classification: 'orphan',
        confidence: 'uncertain',
        verification: 'unverified',
        reason: PDF_MALFORMED_GROUPED_TARGET_REASON,
      },
    ];
  if (!Array.isArray(value) || value.length > PDF_ANNOTATION_LIMITS.targets)
    throw new Error('Invalid grouped PDF targets.');
  return value.map((item) => (loaded ? loadedPdfTarget(item, path) : pdfTarget(item, path)));
}

function pdfFields(value: unknown, requireContent = false): Pick<PdfAnnotation, 'color' | 'label' | 'comment'> {
  const data = object(value);
  if (!PDF_ANNOTATION_COLORS.includes(data.color as PdfAnnotation['color']))
    throw new Error('Invalid PDF annotation color.');
  const valid = {
    color: data.color as PdfAnnotation['color'],
    label: text(data.label, PDF_ANNOTATION_LIMITS.label),
    comment: text(data.comment, PDF_ANNOTATION_LIMITS.comment),
  };
  if (requireContent && !valid.label.trim() && !valid.comment.trim())
    throw new Error('PDF annotations require a label or comment.');
  return valid;
}

function pdfRecord(value: unknown): PdfAnnotation {
  const data = object(value);
  const path = notePath(data.path);
  const id = text(data.id, 36, true);
  const createdAt = text(data.createdAt, 30, true);
  const modifiedAt = text(data.modifiedAt, 30, true);
  if (
    data.schemaVersion !== PDF_ANNOTATION_SCHEMA_VERSION ||
    !/\.pdf$/i.test(path) ||
    path.split('/')[0].toLowerCase() === '.a11ynotebook' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(modifiedAt))
  )
    throw new Error('Invalid PDF annotation record.');
  const targets = pdfTargets(data.targets, path, true);
  return {
    id,
    path,
    target: loadedPdfTarget(data.target, path),
    ...(targets !== undefined ? { targets } : {}),
    ...pdfFields(data),
    createdAt,
    modifiedAt,
    schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
  };
}

/** Callbacks must securely read/write vault-local metadata and reject notes outside the vault, including symlinks. */
function docxAnchor(value: unknown): DocxAnnotationAnchor {
  const data = object(value);
  const quote = text(data.quote, DOCX_ANNOTATION_LIMITS.quote, true);
  if (
    !Number.isSafeInteger(data.blockIndex) ||
    (data.blockIndex as number) < 0 ||
    (data.blockIndex as number) > DOCX_ANNOTATION_LIMITS.blockIndex ||
    (data.cellIndex !== undefined &&
      (!Number.isSafeInteger(data.cellIndex) ||
        (data.cellIndex as number) < 0 ||
        (data.cellIndex as number) > DOCX_ANNOTATION_LIMITS.blockIndex)) ||
    !Number.isSafeInteger(data.start) ||
    !Number.isSafeInteger(data.end) ||
    (data.start as number) < 0 ||
    (data.end as number) - (data.start as number) !== quote.length
  )
    throw new Error('Invalid DOCX annotation anchor.');
  return {
    blockIndex: data.blockIndex as number,
    ...(data.cellIndex !== undefined ? { cellIndex: data.cellIndex as number } : {}),
    quote,
    prefix: text(data.prefix, DOCX_ANNOTATION_LIMITS.context),
    suffix: text(data.suffix, DOCX_ANNOTATION_LIMITS.context),
    start: data.start as number,
    end: data.end as number,
  };
}

function docxRecord(value: unknown): DocxAnnotation {
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
  if (data.schemaVersion !== DOCX_ANNOTATION_SCHEMA_VERSION) throw new Error('Invalid DOCX annotation schema.');
  return {
    id,
    path: notePath(data.path),
    anchor: docxAnchor(data.anchor),
    ...fields(data),
    createdAt,
    updatedAt,
    schemaVersion: DOCX_ANNOTATION_SCHEMA_VERSION,
  };
}

function epubAnchor(value: unknown): EpubAnnotationAnchor {
  const data = object(value);
  const cfiRange = text(data.cfiRange, EPUB_ANNOTATION_LIMITS.cfiRange, true);
  if (!cfiRange.startsWith('epubcfi(')) throw new Error('Invalid ePub annotation CFI.');
  return {
    cfiRange,
    sectionHref: text(data.sectionHref, EPUB_ANNOTATION_LIMITS.sectionHref, true),
    quote: text(data.quote, EPUB_ANNOTATION_LIMITS.quote, true),
    prefix: text(data.prefix, EPUB_ANNOTATION_LIMITS.context),
    suffix: text(data.suffix, EPUB_ANNOTATION_LIMITS.context),
  };
}

function epubRecord(value: unknown): EpubAnnotation {
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
  if (data.schemaVersion !== EPUB_ANNOTATION_SCHEMA_VERSION) throw new Error('Invalid ePub annotation schema.');
  return {
    id,
    path: notePath(data.path),
    anchor: epubAnchor(data.anchor),
    ...fields(data),
    createdAt,
    updatedAt,
    schemaVersion: EPUB_ANNOTATION_SCHEMA_VERSION,
  };
}

export function createAnnotationStore({
  read,
  write: persist,
  validateNote,
  validatePdf,
  validateDocx,
  validateEpub,
  captureAuthorization,
}: AnnotationStoreOptions) {
  let queue: Promise<unknown> = Promise.resolve();
  let activeAuthorization: (() => void) | undefined;
  async function write(value: AnnotationMetadata) {
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
  async function load(): Promise<AnnotationMetadata> {
    const raw = await read();
    activeAuthorization?.();
    if (raw === undefined || raw === null)
      return { version: 4, annotations: [], pdfAnnotations: [], docxAnnotations: [], epubAnnotations: [] };
    const data = object(raw);
    const version = data.version as number;
    const collectionValid = (value: unknown, limit: number) => Array.isArray(value) && value.length <= limit;
    if (
      ![1, 2, 3, 4].includes(version) ||
      !collectionValid(data.annotations, ANNOTATION_LIMITS.records) ||
      (version >= 2 && !collectionValid(data.pdfAnnotations, PDF_ANNOTATION_LIMITS.records)) ||
      (version >= 3 && !collectionValid(data.docxAnnotations, DOCX_ANNOTATION_LIMITS.records)) ||
      (version >= 4 && !collectionValid(data.epubAnnotations, EPUB_ANNOTATION_LIMITS.records))
    ) {
      throw new Error('Invalid annotation metadata.');
    }
    const annotations = (data.annotations as unknown[]).map(record);
    const pdfAnnotations = version >= 2 ? (data.pdfAnnotations as unknown[]).map(pdfRecord) : [];
    const docxAnnotations = version >= 3 ? (data.docxAnnotations as unknown[]).map(docxRecord) : [];
    const epubAnnotations = version >= 4 ? (data.epubAnnotations as unknown[]).map(epubRecord) : [];
    const ids = [...annotations, ...pdfAnnotations, ...docxAnnotations, ...epubAnnotations].map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('Duplicate annotation identifier.');
    }
    return { version: 4, annotations, pdfAnnotations, docxAnnotations, epubAnnotations };
  }
  async function validate(path: unknown) {
    const safe = notePath(path);
    if (!/\.(?:md|html)$/i.test(safe)) throw new Error('Annotations require a Markdown or HTML note.');
    await validateNote(safe);
    return safe;
  }
  async function validatePdfPath(path: unknown) {
    const safe = notePath(path);
    if (safe.split('/')[0].toLowerCase() === '.a11ynotebook') throw new Error('Invalid PDF annotation path.');
    if (!/\.pdf$/i.test(safe)) throw new Error('PDF annotations require a PDF document.');
    if (!validatePdf) throw new Error('PDF annotation validation is unavailable.');
    await validatePdf(safe);
    return safe;
  }
  async function validateDocxPath(path: unknown) {
    const safe = notePath(path);
    if (safe.split('/')[0].toLowerCase() === '.a11ynotebook') throw new Error('Invalid DOCX annotation path.');
    if (!/\.docx$/i.test(safe)) throw new Error('DOCX annotations require a Word document.');
    if (!validateDocx) throw new Error('DOCX annotation validation is unavailable.');
    await validateDocx(safe);
    return safe;
  }
  const docx: DocxAnnotationStore = {
    list(path) {
      return serial(async () => {
        const safe = await validateDocxPath(path);
        return (await load()).docxAnnotations.filter((item) => item.path === safe);
      });
    },
    add(input) {
      return serial(async () => {
        const data = object(input);
        const path = await validateDocxPath(data.path);
        const validAnchor = docxAnchor(data.anchor);
        const validFields = fields(data);
        const metadata = await load();
        if (metadata.docxAnnotations.length >= DOCX_ANNOTATION_LIMITS.records)
          throw new Error('DOCX annotation limit reached.');
        const now = new Date().toISOString();
        const added: DocxAnnotation = {
          id: randomUUID(),
          path,
          anchor: validAnchor,
          ...validFields,
          createdAt: now,
          updatedAt: now,
          schemaVersion: DOCX_ANNOTATION_SCHEMA_VERSION,
        };
        metadata.docxAnnotations.push(added);
        await write(metadata);
        return added;
      });
    },
    update(path, id, patch) {
      return serial(async () => {
        const safe = await validateDocxPath(path);
        const data = object(patch);
        if (Object.keys(data).some((key) => !['color', 'label', 'comment'].includes(key)))
          throw new Error('Invalid DOCX annotation update.');
        const metadata = await load();
        const index = metadata.docxAnnotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('DOCX annotation not found.');
        const updated: DocxAnnotation = {
          ...metadata.docxAnnotations[index],
          ...fields({ ...metadata.docxAnnotations[index], ...data }),
          updatedAt: new Date().toISOString(),
        };
        metadata.docxAnnotations[index] = updated;
        await write(metadata);
        return updated;
      });
    },
    delete(path, id) {
      return serial(async () => {
        const safe = await validateDocxPath(path);
        const metadata = await load();
        const index = metadata.docxAnnotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('DOCX annotation not found.');
        metadata.docxAnnotations.splice(index, 1);
        await write(metadata);
      });
    },
  };
  async function validateEpubPath(path: unknown) {
    const safe = notePath(path);
    if (safe.split('/')[0].toLowerCase() === '.a11ynotebook') throw new Error('Invalid ePub annotation path.');
    if (!/\.epub$/i.test(safe)) throw new Error('ePub annotations require an ePub book.');
    if (!validateEpub) throw new Error('ePub annotation validation is unavailable.');
    await validateEpub(safe);
    return safe;
  }
  const epub: EpubAnnotationStore = {
    list(path) {
      return serial(async () => {
        const safe = await validateEpubPath(path);
        return (await load()).epubAnnotations.filter((item) => item.path === safe);
      });
    },
    add(input) {
      return serial(async () => {
        const data = object(input);
        const path = await validateEpubPath(data.path);
        const validAnchor = epubAnchor(data.anchor);
        const validFields = fields(data);
        const metadata = await load();
        if (metadata.epubAnnotations.length >= EPUB_ANNOTATION_LIMITS.records)
          throw new Error('ePub annotation limit reached.');
        const now = new Date().toISOString();
        const added: EpubAnnotation = {
          id: randomUUID(),
          path,
          anchor: validAnchor,
          ...validFields,
          createdAt: now,
          updatedAt: now,
          schemaVersion: EPUB_ANNOTATION_SCHEMA_VERSION,
        };
        metadata.epubAnnotations.push(added);
        await write(metadata);
        return added;
      });
    },
    update(path, id, patch) {
      return serial(async () => {
        const safe = await validateEpubPath(path);
        const data = object(patch);
        if (Object.keys(data).some((key) => !['color', 'label', 'comment'].includes(key)))
          throw new Error('Invalid ePub annotation update.');
        const metadata = await load();
        const index = metadata.epubAnnotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('ePub annotation not found.');
        const updated: EpubAnnotation = {
          ...metadata.epubAnnotations[index],
          ...fields({ ...metadata.epubAnnotations[index], ...data }),
          updatedAt: new Date().toISOString(),
        };
        metadata.epubAnnotations[index] = updated;
        await write(metadata);
        return updated;
      });
    },
    delete(path, id) {
      return serial(async () => {
        const safe = await validateEpubPath(path);
        const metadata = await load();
        const index = metadata.epubAnnotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('ePub annotation not found.');
        metadata.epubAnnotations.splice(index, 1);
        await write(metadata);
      });
    },
  };
  const pdf: PdfAnnotationStore = {
    list(path) {
      return serial(async () => {
        const safe = await validatePdfPath(path);
        return (await load()).pdfAnnotations.filter((item) => item.path === safe);
      });
    },
    add(input) {
      return serial(async () => {
        const data = object(input);
        const path = await validatePdfPath(data.path);
        const target = pdfTarget(data.target, path);
        const targets = pdfTargets(data.targets, path);
        const validFields = pdfFields(data, true);
        const metadata = await load();
        if (metadata.pdfAnnotations.length >= PDF_ANNOTATION_LIMITS.records)
          throw new Error('PDF annotation limit reached.');
        const now = new Date().toISOString();
        const added: PdfAnnotation = {
          id: randomUUID(),
          path,
          target,
          ...(targets !== undefined ? { targets } : {}),
          ...validFields,
          createdAt: now,
          modifiedAt: now,
          schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
        };
        metadata.pdfAnnotations.push(added);
        await write(metadata);
        return added;
      });
    },
    update(path, id, patch) {
      return serial(async () => {
        const safe = await validatePdfPath(path);
        const data = object(patch);
        if (Object.keys(data).some((key) => !['target', 'targets', 'color', 'label', 'comment'].includes(key)))
          throw new Error('Invalid PDF annotation update.');
        const metadata = await load();
        const index = metadata.pdfAnnotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('PDF annotation not found.');
        const existing = metadata.pdfAnnotations[index];
        const updated: PdfAnnotation = {
          ...existing,
          ...pdfFields({ ...existing, ...data }, true),
          ...(Object.hasOwn(data, 'target') ? { target: pdfTarget(data.target, safe) } : {}),
          ...(Object.hasOwn(data, 'targets') ? { targets: pdfTargets(data.targets, safe) } : {}),
          modifiedAt: new Date().toISOString(),
        };
        metadata.pdfAnnotations[index] = updated;
        await write(metadata);
        return updated;
      });
    },
    delete(path, id) {
      return serial(async () => {
        const safe = await validatePdfPath(path);
        const metadata = await load();
        const index = metadata.pdfAnnotations.findIndex((item) => item.id === id && item.path === safe);
        if (index < 0) throw new Error('PDF annotation not found.');
        metadata.pdfAnnotations.splice(index, 1);
        await write(metadata);
      });
    },
  };
  return {
    pdf,
    docx,
    epub,
    snapshot: () => serial(load),
    restore: (value: AnnotationMetadata) => serial(() => write(value)),
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
          id: randomUUID(),
          path,
          anchor: validAnchor,
          ...validFields,
          createdAt: now,
          updatedAt: now,
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
        for (const item of metadata.pdfAnnotations) {
          if (item.path === source || item.path.startsWith(`${source}/`)) {
            item.path = await validatePdfPath(`${destination}${item.path.slice(source.length)}`);
            for (const target of [item.target, ...(item.targets ?? [])]) target.documentIdentity.vaultPath = item.path;
          }
        }
        for (const item of metadata.docxAnnotations) {
          if (item.path === source || item.path.startsWith(`${source}/`)) {
            item.path = await validateDocxPath(`${destination}${item.path.slice(source.length)}`);
          }
        }
        for (const item of metadata.epubAnnotations) {
          if (item.path === source || item.path.startsWith(`${source}/`)) {
            item.path = await validateEpubPath(`${destination}${item.path.slice(source.length)}`);
          }
        }
        await write(metadata);
      });
    },
  };
}
