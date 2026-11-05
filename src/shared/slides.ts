// Shared slide-deck model: decks read from PPTX and ODP for the
// read-only slide view. Slides are text only in this release — layout,
// images, and animations are not represented.
export interface SlideTextBlock {
  kind: 'title' | 'body' | 'other';
  text: string;
}

export interface Slide {
  index: number;
  /** Text of the first title block, or ''. */
  title: string;
  blocks: SlideTextBlock[];
  /** Speaker-notes text, or ''. */
  notes: string;
}

export type SlideDeckSourceFormat = 'pptx' | 'odp';

export interface SlideDeck {
  sourceFormat: SlideDeckSourceFormat;
  slides: Slide[];
  unsupportedFeatures: string[];
  truncated: boolean;
  truncationReason?: string;
}
