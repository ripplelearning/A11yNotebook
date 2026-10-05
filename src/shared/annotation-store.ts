import {
  PDF_ANNOTATION_SCHEMA_VERSION,
  type NewPdfAnnotation,
  type PdfAnnotation,
  type PdfAnnotationUpdate,
} from './pdf-annotation';
import { NOTE_ANNOTATION_SCHEMA_VERSION, type NoteAnnotation } from './annotations';

export type AnnotationRecord = NoteAnnotation | PdfAnnotation;

export const ANNOTATION_SCHEMA_VERSIONS = {
  pdf: PDF_ANNOTATION_SCHEMA_VERSION,
  markdown: NOTE_ANNOTATION_SCHEMA_VERSION,
  html: NOTE_ANNOTATION_SCHEMA_VERSION,
} as const;

export interface PdfAnnotationStore {
  list(path: string): Promise<PdfAnnotation[]>;
  add(input: NewPdfAnnotation): Promise<PdfAnnotation>;
  update(path: string, id: string, patch: PdfAnnotationUpdate): Promise<PdfAnnotation>;
  delete(path: string, id: string): Promise<void>;
}
