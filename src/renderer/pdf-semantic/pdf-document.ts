import type { PDFDocumentProxy, PDFPageProxy, TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api';
import type { MarkedContentRange, PdfAnchorResolution, PdfTextPart, TextCoordinates, TextModel } from './text-model';
import { isValidPdfAnchor, malformedStoredAnchorResolution, TextModel as CanonicalTextModel } from './text-model';
import type { PdfAnnotationTarget } from '../../shared/pdf-annotation';
import { createReflowView } from './reflow-view';
import { StructAdapter, type SemanticNode } from './struct-adapter';
import { HeuristicClassifier, type InferredPage } from './heuristic-classifier';
import { createTextLayer, getSelectionOffsets, selectTextRange } from './text-layer';
import { ViewportTransform } from './viewport-transform';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PdfReadingPreferences } from '../../shared/pdf-reading-preferences';
import { DEFAULT_PDF_READING_PREFERENCES } from '../../shared/pdf-reading-preferences';
import { applyPdfReadingPreferences } from './reading-preferences';
import { extractPageFormFields } from './pdf-form-fields';
import { insertFormFieldsIntoSemanticDOM, type PdfFormDomOptions } from './pdf-form-dom';
import type { PdfFormField, PdfWidgetAnnotation } from '../../shared/pdf-form';

let pdfModule: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;

export type PdfAnnotation = {
  subtype?: string;
  url?: string;
  dest?: unknown;
  rect?: number[];
  title?: string;
};

export interface PdfMetadata {
  title?: string;
  language?: string;
  producer?: string;
}

export class PdfDocument {
  readonly vaultPath: string;
  readonly fileHash: string;
  fingerprints: [string, string?] = ['', undefined];
  metadata: PdfMetadata = {};
  pageLabels: string[] = [];
  numPages = 0;
  /**
   * True when the PDF restricts printing, copying, or editing. It still
   * opens and reads — pdf.js reports the restriction through
   * getPermissions() — but notes and a filled file are unavailable, so
   * the reader treats it as read-only. A password-protected PDF opened
   * with its password reports this too; the reader keeps the password
   * state separate, since that one asks for the password at open.
   */
  permissionProtected = false;
  private readonly loadingTask: Promise<PDFDocumentLoadingTask>;
  private readonly pdfPromise: Promise<PDFDocumentProxy>;
  private readonly pages = new Map<number, Promise<PdfPage>>();

  constructor(
    pdfBytes: Uint8Array,
    fileHash: string,
    vaultPath: string,
    private readingPreferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
    options: { password?: string } = {},
  ) {
    this.fileHash = fileHash;
    this.vaultPath = vaultPath;
    this.loadingTask = (pdfModule ??= import('pdfjs-dist/legacy/build/pdf.mjs')).then(
      ({ GlobalWorkerOptions, getDocument }) => {
        if (typeof window !== 'undefined') GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return getDocument({
          data: pdfBytes.slice(),
          disableAutoFetch: true,
          disableRange: true,
          disableStream: true,
          useSystemFonts: false,
          // XFA forms are attempted, not refused: static XFA fields
          // surface through the same field APIs as AcroForm fields,
          // and dynamic XFA simply yields no fields (reported by the
          // reader instead of failing the open).
          enableXfa: true,
          ...(options.password ? { password: options.password } : {}),
        });
      },
    );
    this.pdfPromise = this.loadingTask
      .then((task) => task.promise)
      .then(async (pdf) => {
        const fingerprints = pdf.fingerprints ?? [];
        this.fingerprints = [fingerprints[0] ?? fileHash, fingerprints[1] ?? undefined];
        this.numPages = pdf.numPages;
        // A permissions lookup must never fail the open: it is only a
        // read-only flag, so an unavailable lookup reads as unprotected.
        try {
          this.permissionProtected = (await pdf.getPermissions()) !== null;
        } catch {
          this.permissionProtected = false;
        }
        this.pageLabels = (await pdf.getPageLabels()) ?? [];
        const { info, metadata } = await pdf.getMetadata();
        const infoValues = info as Record<string, unknown>;
        this.metadata = {
          title: typeof infoValues.Title === 'string' && infoValues.Title ? infoValues.Title : undefined,
          language:
            (typeof infoValues.Language === 'string' && infoValues.Language) ||
            (typeof metadata?.get === 'function' ? metadata.get('dc:language') : undefined),
          producer: typeof infoValues.Producer === 'string' && infoValues.Producer ? infoValues.Producer : undefined,
        };
        return pdf;
      });
  }

  get ready(): Promise<void> {
    return this.pdfPromise.then(() => undefined);
  }

  get documentIdentity(): PdfAnnotationTarget['documentIdentity'] {
    return { fingerprint: this.fingerprints[0] || this.fileHash, fileHash: this.fileHash, vaultPath: this.vaultPath };
  }

  async resolveAnnotationAnchor(target: PdfAnnotationTarget): Promise<PdfAnchorResolution> {
    if (!isValidPdfAnchor(target)) {
      return {
        orphaned: true,
        classification: 'orphan',
        confidence: 'uncertain',
        reason: 'Malformed PDF annotation target.',
      };
    }
    const malformedStored = malformedStoredAnchorResolution(target);
    if (malformedStored) return malformedStored;
    await this.ready;
    if (this.vaultPath !== target.documentIdentity.vaultPath) {
      return {
        orphaned: true,
        classification: 'orphan',
        confidence: 'uncertain',
        verification: 'unverified',
        reason: 'PDF library path does not match the annotation document identity.',
      };
    }
    if (target.page <= this.numPages) {
      const initial = (await this.getPage(target.page)).resolveAnnotationAnchor(target);
      if (!initial.orphaned) return initial;
    }
    const candidates: Array<Extract<PdfAnchorResolution, { offset: number }>> = [];
    for (let page = Math.max(1, target.page - 2); page <= Math.min(this.numPages, target.page + 2); page += 1) {
      if (page === target.page) continue;
      const candidate = (await this.getPage(page)).resolveAnnotationAnchor(target);
      if (!candidate.orphaned) candidates.push(candidate);
    }
    if (candidates.length === 1 && candidates[0].classification !== 'ambiguous') {
      const candidate = candidates[0];
      return {
        ...candidate,
        reason: `Resolved on nearby page ${candidate.page}. ${candidate.reason}`,
      };
    }
    const verification =
      this.fileHash !== target.documentIdentity.fileHash || target.verification === 'unverified'
        ? 'unverified'
        : 'verified';
    if (candidates.length) {
      return {
        offset: -1,
        page: target.page,
        classification: 'ambiguous',
        confidence: 'uncertain',
        verification,
        reason: 'Nearby pages contain multiple possible quote matches; manual reconfirmation is required.',
      };
    }
    return {
      orphaned: true,
      classification: 'orphan',
      confidence: 'uncertain',
      verification,
      reason:
        'Quote not found on the original page or within two nearby pages.' +
        (verification === 'unverified' ? ' File identity requires manual reconfirmation before highlighting.' : ''),
    };
  }

  setReadingPreferences(preferences: PdfReadingPreferences): void {
    this.readingPreferences = { ...preferences };
    for (const page of this.pages.values()) {
      void page.then(
        (loaded) => loaded.setReadingPreferences(this.readingPreferences),
        () => undefined,
      );
    }
  }

  async getPage(pageNum: number): Promise<PdfPage> {
    if (!Number.isInteger(pageNum) || pageNum < 1) throw new RangeError('PDF page number must be a positive integer.');
    const cached = this.pages.get(pageNum);
    if (cached) return cached;
    const created = this.pdfPromise.then(async (pdf) => {
      if (pageNum > pdf.numPages) throw new RangeError('PDF page number is out of range.');
      return PdfPage.create(
        await pdf.getPage(pageNum),
        pageNum,
        this.pageLabels[pageNum - 1],
        this.readingPreferences,
        this.documentIdentity,
      );
    });
    this.pages.set(pageNum, created);
    return created;
  }

  /** Every fillable field in the document, in reading order. */
  async getFormFields(): Promise<PdfFormField[]> {
    await this.ready;
    const fields: PdfFormField[] = [];
    for (let pageNum = 1; pageNum <= this.numPages; pageNum += 1) {
      fields.push(...(await this.getPage(pageNum)).formFields);
    }
    return fields;
  }

  async classifyUntaggedPages(pageNumbers: number[]): Promise<void> {
    const pages = await Promise.all(pageNumbers.map((pageNumber) => this.getPage(pageNumber)));
    const classified = new HeuristicClassifier().classifyPages(pages.map((page) => page.textModel));
    pages.forEach((page, index) => page.setInferredPage(classified[index]));
  }

  private destroyed = false;

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pages.clear();
    const task = await this.loadingTask;
    await task.destroy();
  }
}

export class PdfPage {
  readonly pageNum: number;
  readonly label: string;
  readonly textModel: TextModel;
  readonly semanticTree: SemanticNode | null;
  readonly nativeAnnotations: PdfAnnotation[];
  /** Fillable form fields on this page, in reading order. */
  readonly formFields: PdfFormField[];
  readonly canRotate: number;
  readonly view: [number, number, number, number];
  private readonly page: PDFPageProxy;
  private readonly structure: Awaited<ReturnType<PDFPageProxy['getStructTree']>>;
  private textLayer: HTMLDivElement | null = null;
  private inferredPage: InferredPage | undefined;

  private constructor(
    page: PDFPageProxy,
    pageNum: number,
    label: string,
    textModel: TextModel,
    structure: Awaited<ReturnType<PDFPageProxy['getStructTree']>>,
    nativeAnnotations: PdfAnnotation[],
    formFields: PdfFormField[],
    private readingPreferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
  ) {
    this.page = page;
    this.pageNum = pageNum;
    this.label = label;
    this.textModel = textModel;
    this.structure = structure;
    this.semanticTree = structure ? new StructAdapter(structure, textModel).adapt() : null;
    this.nativeAnnotations = nativeAnnotations;
    this.formFields = formFields;
    this.canRotate = [0, 90, 180, 270].includes(page.rotate) ? page.rotate : 0;
    this.view = page.view as [number, number, number, number];
    this.textModel.setView(this.view);
  }

  static async create(
    page: PDFPageProxy,
    pageNum: number,
    label?: string,
    preferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
    identity?: PdfAnnotationTarget['documentIdentity'],
  ): Promise<PdfPage> {
    const [content, structure, annotations] = await Promise.all([
      page.getTextContent({ includeMarkedContent: true }),
      page.getStructTree(),
      page.getAnnotations(),
    ]);
    const markedContentMap = new Map<string, MarkedContentRange>();
    const parts = content.items as Array<TextItem | TextMarkedContent>;
    const model = new CanonicalTextModel(
      parts as PdfTextPart[],
      markedContentMap,
      page.view as [number, number, number, number],
      pageNum,
      identity,
    );
    const links = annotations.flatMap((annotation) => {
      if (annotation.subtype !== 'Link') return [];
      const safeUrl =
        typeof annotation.url === 'string' && /^https?:\/\//i.test(annotation.url) ? annotation.url : undefined;
      return [
        {
          subtype: 'Link',
          ...(safeUrl ? { url: safeUrl } : {}),
          ...(annotation.dest !== undefined ? { dest: annotation.dest } : {}),
          ...(Array.isArray(annotation.rect) && annotation.rect.every(Number.isFinite)
            ? { rect: annotation.rect }
            : {}),
          ...(typeof annotation.title === 'string' ? { title: annotation.title } : {}),
        },
      ];
    });
    const rotation = [0, 90, 180, 270].includes(page.rotate) ? page.rotate : 0;
    const formFields = extractPageFormFields(
      annotations as PdfWidgetAnnotation[],
      pageNum,
      model,
      page.view as [number, number, number, number],
      rotation,
    );
    return new PdfPage(page, pageNum, label || `Page ${pageNum}`, model, structure, links, formFields, preferences);
  }

  get documentIdentity(): PdfAnnotationTarget['documentIdentity'] | undefined {
    return this.textModel.documentIdentity;
  }

  createAnnotationAnchor(start: number, length: number): PdfAnnotationTarget {
    return this.textModel.createAnchor(this.pageNum, start, length);
  }

  resolveAnnotationAnchor(target: PdfAnnotationTarget): PdfAnchorResolution {
    return this.textModel.resolveAnchor(target);
  }

  async renderCanvas(zoom = 1, rotation = 0, maxScale = 2): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    const pageRotation = (this.page.rotate + rotation) % 360;
    const unscaled = this.page.getViewport({ scale: 1, rotation: pageRotation });
    const scale = Math.min(
      Math.max(0.1, zoom),
      // The display cap is 2; OCR passes 3 for ~216 DPI, where the
      // recognizer's accuracy falls off below 200 DPI.
      maxScale,
      2000 / unscaled.width,
      2600 / unscaled.height,
      Math.sqrt(4_000_000 / (unscaled.width * unscaled.height)),
    );
    const viewport = this.page.getViewport({ scale, rotation: pageRotation });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await this.page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas;
  }

  getTextSelection(layer?: HTMLElement): { startOffset: number; length: number } | null {
    return getSelectionOffsets(layer ?? this.textLayer ?? document.createElement('div'));
  }

  highlightAtAnchor(offset: number, length: number, zoom = 1, rotation = 0): TextCoordinates | null {
    const effectiveRotation = (this.canRotate + rotation) % 360;
    return length > 0
      ? this.textModel.offsetToCoordinates(offset, length, zoom, effectiveRotation)
      : this.textModel.offsetToCoordinates(offset, zoom, effectiveRotation);
  }

  selectTextRange(startOffset: number, length: number, layer?: HTMLElement): boolean {
    return selectTextRange(layer ?? this.textLayer ?? document.createElement('div'), startOffset, length);
  }

  getSemanticDOM(preferences?: PdfReadingPreferences): HTMLElement;
  getSemanticDOM(zoom?: number, rotation?: number, preferences?: PdfReadingPreferences): HTMLElement;
  getSemanticDOM(
    zoom?: number,
    rotation?: number,
    preferences?: PdfReadingPreferences,
    form?: PdfFormDomOptions,
  ): HTMLElement;
  getSemanticDOM(
    zoomOrPreferences: number | PdfReadingPreferences = 1,
    rotation = 0,
    preferences?: PdfReadingPreferences,
    form?: PdfFormDomOptions,
  ): HTMLElement {
    const zoom = typeof zoomOrPreferences === 'number' ? zoomOrPreferences : 1;
    const updatedPreferences = typeof zoomOrPreferences === 'number' ? preferences : zoomOrPreferences;
    if (updatedPreferences) this.readingPreferences = { ...updatedPreferences };
    const root = this.structure
      ? new StructAdapter(this.structure, this.textModel, this.inferredPage).toDOM(document, this.readingPreferences)
      : createReflowView(document, this.textModel, null, this.inferredPage, this.readingPreferences);
    root.dataset.pageNumber = String(this.pageNum);
    root.dataset.zoom = String(zoom);
    root.dataset.rotation = String((this.canRotate + rotation) % 360);
    if (form && this.formFields.length) {
      insertFormFieldsIntoSemanticDOM(
        root,
        this.formFields,
        this.textModel,
        this.view,
        zoom,
        (this.canRotate + rotation) % 360,
        form,
      );
    }
    return root;
  }

  setInferredPage(page: InferredPage): void {
    this.inferredPage = page;
  }

  setReadingPreferences(preferences: PdfReadingPreferences): void {
    this.readingPreferences = { ...preferences };
  }

  getTextLayer(zoom = 1, rotation = 0): HTMLDivElement {
    this.textLayer = createTextLayer(this.textModel, document, zoom, (this.canRotate + rotation) % 360);
    const semantic = this.getSemanticDOM();
    const ranges = [...semantic.querySelectorAll<HTMLElement>('[data-start-offset]')].map((span) => ({
      startOffset: Number(span.dataset.startOffset),
      endOffset: Number(span.dataset.endOffset),
      artifactType: span.closest<HTMLElement>('[data-pdf-artifact-type]')?.dataset.pdfArtifactType,
      annotation: Boolean(span.closest('[data-pdf-annotation]')),
    }));
    for (const span of this.textLayer.querySelectorAll<HTMLElement>('[data-start-offset]')) {
      const startOffset = Number(span.dataset.startOffset);
      const endOffset = Number(span.dataset.endOffset);
      const range = ranges.find(
        (candidate) => candidate.startOffset <= startOffset && candidate.endOffset >= endOffset,
      );
      if (range?.annotation) span.dataset.pdfAnnotation = 'link';
      else if (range?.artifactType) span.dataset.pdfArtifactType = range.artifactType;
    }
    applyPdfReadingPreferences(this.textLayer, this.readingPreferences);
    return this.textLayer;
  }

  coordinatesToOffset(x: number, y: number, zoom = 1, rotation = 0): number | null {
    return this.textModel.coordinatesToOffset(x, y, zoom, (this.canRotate + rotation) % 360);
  }

  viewportTransform(zoom = 1, rotation = 0): ViewportTransform {
    return new ViewportTransform(this.view, zoom, (this.canRotate + rotation) % 360);
  }
}
