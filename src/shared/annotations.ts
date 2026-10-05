export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export const NOTE_ANNOTATION_SCHEMA_VERSION = 1 as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

/** Offsets refer to the rendered document's concatenated text nodes, not Markdown source. */
export interface AnnotationAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface NoteAnnotation {
  id: string;
  path: string;
  anchor: AnnotationAnchor;
  color: AnnotationColor;
  label: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export type NewAnnotation = Pick<NoteAnnotation, 'path' | 'anchor' | 'color' | 'label' | 'comment'>;
export type AnnotationUpdate = Partial<Pick<NoteAnnotation, 'color' | 'label' | 'comment'>>;

export const ANNOTATION_LIMITS = {
  quote: 10_000,
  context: 64,
  label: 100,
  comment: 10_000,
  records: 5_000,
} as const;
