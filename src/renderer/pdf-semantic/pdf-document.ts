import type { PDFDocumentProxy, PDFPageProxy, TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api';
import type { MarkedContentRange, PdfTextPart, TextCoordinates, TextModel } from './text-model';
import { TextModel as CanonicalTextModel } from './text-model';
import { createReflowView } from './reflow-view';
import { StructAdapter, type SemanticNode } from './struct-adapter';
import { HeuristicClassifier, type InferredPage } from './heuristic-classifier';
import { createTextLayer, getSelectionOffsets, selectTextRange } from './text-layer';
import { ViewportTransform } from './viewport-transform';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PdfReadingPreferences } from '../../shared/pdf-reading-preferences';
import { DEFAULT_PDF_READING_PREFERENCES } from '../../shared/pdf-reading-preferences';
import { applyPdfReadingPreferences } from './reading-preferences';

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
  private readonly loadingTask: Promise<PDFDocumentLoadingTask>;
  private readonly pdfPromise: Promise<PDFDocumentProxy>;
  private readonly pages = new Map<number, Promise<PdfPage>>();

  constructor(
    pdfBytes: Uint8Array,
    fileHash: string,
    vaultPath: string,
    private readingPreferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
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
          enableXfa: false,
        });
      },
    );
    this.pdfPromise = this.loadingTask
      .then((task) => task.promise)
      .then(async (pdf) => {
        const fingerprints = pdf.fingerprints ?? [];
        this.fingerprints = [fingerprints[0] ?? fileHash, fingerprints[1] ?? undefined];
        this.numPages = pdf.numPages;
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
      return PdfPage.create(await pdf.getPage(pageNum), pageNum, this.pageLabels[pageNum - 1], this.readingPreferences);
    });
    this.pages.set(pageNum, created);
    return created;
  }

  async classifyUntaggedPages(pageNumbers: number[]): Promise<void> {
    const pages = await Promise.all(pageNumbers.map((pageNumber) => this.getPage(pageNumber)));
    const classified = new HeuristicClassifier().classifyPages(pages.map((page) => page.textModel));
    pages.forEach((page, index) => page.setInferredPage(classified[index]));
  }

  async destroy(): Promise<void> {
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
    private readingPreferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
  ) {
    this.page = page;
    this.pageNum = pageNum;
    this.label = label;
    this.textModel = textModel;
    this.structure = structure;
    this.semanticTree = structure ? new StructAdapter(structure, textModel).adapt() : null;
    this.nativeAnnotations = nativeAnnotations;
    this.canRotate = [0, 90, 180, 270].includes(page.rotate) ? page.rotate : 0;
    this.view = page.view as [number, number, number, number];
    this.textModel.setView(this.view);
  }

  static async create(
    page: PDFPageProxy,
    pageNum: number,
    label?: string,
    preferences: PdfReadingPreferences = DEFAULT_PDF_READING_PREFERENCES,
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
    return new PdfPage(page, pageNum, label || `Page ${pageNum}`, model, structure, links, preferences);
  }

  async renderCanvas(zoom = 1, rotation = 0): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    const pageRotation = (this.page.rotate + rotation) % 360;
    const unscaled = this.page.getViewport({ scale: 1, rotation: pageRotation });
    const scale = Math.min(
      Math.max(0.1, zoom),
      2,
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
    const start = this.textModel.offsetToCoordinates(offset, zoom, effectiveRotation);
    if (!start || length <= 0) return start;
    const end = this.textModel.offsetToCoordinates(offset + length - 1, zoom, effectiveRotation);
    if (!end) return start;
    const left = Math.min(start[0], end[0]);
    const top = Math.min(start[1], end[1]);
    const right = Math.max(start[0] + start[2], end[0] + end[2]);
    const bottom = Math.max(start[1] + start[3], end[1] + end[3]);
    return [left, top, right - left, bottom - top];
  }

  selectTextRange(startOffset: number, length: number, layer?: HTMLElement): boolean {
    return selectTextRange(layer ?? this.textLayer ?? document.createElement('div'), startOffset, length);
  }

  getSemanticDOM(preferences?: PdfReadingPreferences): HTMLElement;
  getSemanticDOM(zoom?: number, rotation?: number, preferences?: PdfReadingPreferences): HTMLElement;
  getSemanticDOM(
    zoomOrPreferences: number | PdfReadingPreferences = 1,
    rotation = 0,
    preferences?: PdfReadingPreferences,
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
