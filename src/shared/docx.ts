export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  style?: string;
  link?: string;
  image?: { altText: string; mediaType: string };
}

export interface DocxParagraph {
  kind: 'paragraph';
  text: string;
  runs: DocxRun[];
  styleId?: string;
  headingLevel?: number;
  list?: { ordered: boolean; level: number };
  breaks?: Array<'page' | 'column'>;
  sectionBreak?: boolean;
}

export interface DocxTable {
  kind: 'table';
  rows: Array<{ cells: Array<{ paragraphs: DocxParagraph[] }> }>;
}

export interface DocxStructure {
  title?: string;
  author?: string;
  created?: string;
  blocks: Array<DocxParagraph | DocxTable>;
  headings: Array<{ level: number; text: string; blockIndex: number }>;
  links: Array<{ text: string; target: string; blockIndex: number }>;
  sectionCount: number;
  unsupportedFeatures: string[];
  truncated: boolean;
  truncationReason?: string;
}
