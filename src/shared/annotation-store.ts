import type { NewPdfAnnotation, PdfAnnotation, PdfAnnotationUpdate } from './pdf-annotation';

export interface PdfAnnotationStore {
  list(path: string): Promise<PdfAnnotation[]>;
  add(input: NewPdfAnnotation): Promise<PdfAnnotation>;
  update(path: string, id: string, patch: PdfAnnotationUpdate): Promise<PdfAnnotation>;
  delete(path: string, id: string): Promise<void>;
}
