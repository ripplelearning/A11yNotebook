import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api';
import type { MarkedContentRange, PdfTextPart, TextCoordinates, TextModel } from './text-model';
import { TextModel as CanonicalTextModel } from './text-model';
import { createReflowView } from './reflow-view';
import { StructAdapter, type SemanticNode } from './struct-adapter';
import { createTextLayer, getSelectionOffsets, selectTextRange } from './text-layer';
import { ViewportTransform } from './viewport-transform';

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
  private readonly loadingTask: PDFDocumentLoadingTask;
  private readonly pdfPromise: Promise<PDFDocumentProxy>;
  private readonly pages = new Map<number, Promise<PdfPage>>();

  constructor(pdfBytes: Uint8Array, fileHash: string, vaultPath: string) {
    this.fileHash = fileHash;
    this.vaultPath = vaultPath;
    const bytes = pdfBytes.slice();
    this.loadingTask = this.load(bytes);
    this.pdfPromise = this.loadingTask.promise.then(async (pdf) => {
      const fingerprints = pdf.fingerprints ?? [];
      this.fingerprints = [fingerprints[0] ?? fileHash, fingerprints[1] ?? undefined];
      this.numPages = pdf.numPages;
      this.pageLabels = (await pdf.getPageLabels()) ?? [];
      const { info, metadata } = await pdf.getMetadata();
      this.metadata = {
        title: typeof info.Title === 'string' && info.Title ? info.Title : undefined,
        language:
          (typeof info.Language === 'string' && info.Language) ||
          (typeof metadata?.get === 'function' ? metadata.get('dc:language') : undefined),
        producer: typeof info.Producer === 'string' && info.Producer ? info.Producer : undefined,
      };
      return pdf;
    });
  }

  async getPage(pageNum: number): Promise<PdfPage> {
    if (!Number.isInteger(pageNum) || pageNum < 1) throw new RangeError('PDF page number must be a positive integer.');
    const cached = this.pages.get(pageNum);
    if (cached) return cached;
    const created = this.pdfPromise.then(async (pdf) => {
      if (pageNum > pdf.numPages) throw new RangeError('PDF page number is out of range.');
      return PdfPage.create(await pdf.getPage(pageNum), pageNum, this.pageLabels[pageNum - 1]);
    });
    this.pages.set(pageNum, created);
    return created;
  }

  async destroy(): Promise<void> {
    this.pages.clear();
    await this.loadingTask.destroy();
  }

  private load(bytes: Uint8Array): PDFDocumentLoadingTask {
    const getDocument = (globalThis as typeof globalThis & {
      __pdfjsGetDocument?: (params: Record<string, unknown>) => PDFDocumentLoadingTask;
    }).__pdfjsGetDocument;
    if (getDocument) return getDocument({ data: bytes });
    throw new Error('Use PdfDocument.open() to load PDF.js before constructing a document.');
  }

  static async open(
    pdfBytes: Uint8Array,
    fileHash: string,
    vaultPath: string,
    pdfjs: { getDocument: (params: Record<string, unknown>) => PDFDocumentLoadingTask },
  ): Promise<PdfDocument> {
    const document = Object.create(PdfDocument.prototype) as PdfDocument;
    Object.defineProperties(document, {
      fileHash: { value: fileHash, enumerable: true },
      vaultPath: { value: vaultPath, enumerable: true },
      fingerprints: { value: ['', undefined], writable: true, enumerable: true },
      metadata: { value: {}, writable: true, enumerable: true },
      pageLabels: { value: [], writable: true, enumerable: true },
      numPages: { value: 0, writable: true, enumerable: true },
      pages: { value: new Map() },
      loadingTask: { value: pdfjs.getDocument({ data: pdfBytes.slice() }) },
    });
    const instance = document as PdfDocument;
    Object.defineProperty(instance, 'pdfPromise', {
      value: instance.loadingTask.promise.then(async (pdf) => {
        const fingerprints = pdf.fingerprints ?? [];
        instance.fingerprints = [fingerprints[0] ?? fileHash, fingerprints[1] ?? undefined];
        instance.numPages = pdf.numPages;
        instance.pageLabels = (await pdf.getPageLabels()) ?? [];
        const { info, metadata } = await pdf.getMetadata();
        instance.metadata = {
          title: typeof info.Title === 'string' && info.Title ? info.Title : undefined,
          language:
            (typeof info.Language === 'string' && info.Language) ||
            (typeof metadata?.get === 'function' ? metadata.get('dc:language') : undefined),
          producer: typeof info.Producer === 'string' && info.Producer ? info.Producer : undefined,
        };
        return pdf;
      }),
    });
    await instance.pdfPromise;
    return instance;
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

  private constructor(
    page: PDFPageProxy,
    pageNum: number,
    label: string,
    textModel: TextModel,
    structure: Awaited<ReturnType<PDFPageProxy['getStructTree']>>,
    nativeAnnotations: PdfAnnotation[],
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

  static async create(page: PDFPageProxy, pageNum: number, label?: string): Promise<PdfPage> {
    const [content, structure, annotations] = await Promise.all([
      page.getTextContent({ includeMarkedContent: true }),
      page.getStructTree(),
      page.getAnnotations(),
    ]);
    const markedContentMap = new Map<string, MarkedContentRange>();
    const parts = content.items as Array<TextItem | TextMarkedContent>;
    const model = new CanonicalTextModel(parts as PdfTextPart[], markedContentMap, page.view as [number, number, number, number]);
    return new PdfPage(
      page,
      pageNum,
      label || `Page ${pageNum}`,
      model,
      structure,
      annotations.filter((annotation) => annotation.subtype === 'Link') as PdfAnnotation[],
    );
  }

  async renderCanvas(zoom = 1, rotation = 0): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    const viewport = this.page.getViewport({ scale: zoom, rotation: (this.page.rotate + rotation) % 360 });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await this.page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas;
  }

  getTextSelection(layer?: HTMLElement): { startOffset: number; length: number } | null {
    return layer ? getSelectionOffsets(layer) : null;
  }

  highlightAtAnchor(offset: number, length: number, zoom = 1, rotation = 0): TextCoordinates | null {
    const start = this.textModel.offsetToCoordinates(offset, zoom, rotation);
    if (!start || length <= 0) return start;
    const end = this.textModel.offsetToCoordinates(offset + length - 1, zoom, rotation);
    if (!end) return start;
    return [start[0], Math.min(start[1], end[1]), Math.max(0, end[0] + end[2] - start[0]), Math.max(start[3], end[3])];
  }

  selectTextRange(startOffset: number, length: number, layer?: HTMLElement): boolean {
    return layer ? selectTextRange(layer, startOffset, length) : false;
  }

  getSemanticDOM(zoom = 1, rotation = 0): HTMLElement {
    const root = this.structure
      ? new StructAdapter(this.structure, this.textModel).toDOM(document)
      : createReflowView(document, this.textModel, null);
    root.dataset.pageNumber = String(this.pageNum);
    root.dataset.zoom = String(zoom);
    root.dataset.rotation = String(rotation);
    return root;
  }

  getTextLayer(zoom = 1, rotation = 0): HTMLDivElement {
    return createTextLayer(this.textModel, document, zoom, rotation);
  }

  coordinatesToOffset(x: number, y: number, zoom = 1, rotation = 0): number | null {
    return this.textModel.coordinatesToOffset(x, y, zoom, rotation);
  }

  viewportTransform(zoom = 1, rotation = 0): ViewportTransform {
    return new ViewportTransform(this.view, zoom, rotation);
  }
}
