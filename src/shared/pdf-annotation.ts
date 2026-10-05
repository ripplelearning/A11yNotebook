export const PDF_ANNOTATION_COLORS = ['red', 'yellow', 'green', 'blue', 'none'] as const;
export const PDF_ANNOTATION_SCHEMA_VERSION = 1 as const;
export const PDF_MALFORMED_TARGET_REASON = 'Stored PDF target was malformed; select text again to re-anchor.';
export const PDF_MALFORMED_GROUPED_TARGET_REASON =
  'Stored grouped PDF target was malformed; select text again to re-anchor.';
export type PdfAnnotationColor = (typeof PDF_ANNOTATION_COLORS)[number];
export type PdfAnnotationClassification = 'exact' | 'context-disambiguated' | 'normalized' | 'ambiguous' | 'orphan';
export type PdfAnnotationConfidence = 'certain' | 'probable' | 'uncertain';

export interface PdfDocumentIdentity {
  fingerprint: string;
  fileHash: string;
  vaultPath: string;
}

/** Offsets address a page's canonical text; page numbers start at one. */
export interface PdfAnnotationTarget {
  kind: 'pdf';
  documentIdentity: PdfDocumentIdentity;
  page: number;
  canonicalStart: number;
  canonicalLength: number;
  exactQuote: string;
  normalizedQuote: string;
  contextBefore: string;
  contextAfter: string;
  structPath?: string;
  classification: PdfAnnotationClassification;
  confidence: PdfAnnotationConfidence;
  verification?: 'verified' | 'unverified';
  manuallyConfirmed?: boolean;
  reason?: string;
}

export interface PdfAnnotation {
  id: string;
  path: string;
  target: PdfAnnotationTarget;
  /** Additional page targets in a single grouped annotation. */
  targets?: PdfAnnotationTarget[];
  color: PdfAnnotationColor;
  label: string;
  comment: string;
  createdAt: string;
  modifiedAt: string;
  schemaVersion: typeof PDF_ANNOTATION_SCHEMA_VERSION;
}

export type NewPdfAnnotation = Pick<PdfAnnotation, 'path' | 'target' | 'targets' | 'color' | 'label' | 'comment'>;
export type PdfAnnotationUpdate = Partial<Pick<PdfAnnotation, 'target' | 'targets' | 'color' | 'label' | 'comment'>>;

export const PDF_ANNOTATION_LIMITS = {
  quote: 10_000,
  context: 256,
  label: 100,
  comment: 10_000,
  reason: 1_000,
  targets: 100,
  records: 5_000,
} as const;
