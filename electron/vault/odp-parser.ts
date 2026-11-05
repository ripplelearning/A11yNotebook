import type { Element as XmlElement } from '@xmldom/xmldom';
import {
  childElements,
  descendants,
  paragraphText,
  parseXml,
} from './office-xml';
import { readZipEntries } from './zip-archive';
import type { Slide, SlideDeck, SlideTextBlock } from '../../src/shared/slides';

const LABEL = 'ODP';
const MAX_SLIDES = 500;
const MAX_BLOCKS_PER_SLIDE = 200;
const MAX_TEXT_BYTES = 1024 * 1024;

function invalid(message: string): never {
  throw new Error(message);
}

function frameText(frame: XmlElement): string {
  const paragraphs: string[] = [];
  for (const textBox of descendants(frame, 'text-box', LABEL, 10)) {
    for (const paragraph of childElements(textBox, 'p')) {
      paragraphs.push(paragraphText(paragraph));
    }
  }
  return paragraphs.join('\n');
}

function frameKind(frame: XmlElement): SlideTextBlock['kind'] {
  const presentationClass = frame.getAttribute('presentation:class') || '';
  if (presentationClass === 'title') return 'title';
  if (presentationClass === 'outline' || presentationClass === 'subtitle') return 'body';
  return 'other';
}

export function parseOdpDeck(bytes: Buffer): SlideDeck {
  const entries = readZipEntries(bytes, LABEL);
  const document = parseXml(entries, 'content.xml', LABEL);
  if (!document || !document.documentElement) invalid(`The ${LABEL} part content.xml is missing.`);
  const body = descendants(document.documentElement, 'body', LABEL, 10)[0];
  const presentation = body ? childElements(body, 'presentation')[0] : undefined;
  if (!presentation) invalid(`The ${LABEL} file contains no presentation.`);
  const pages = childElements(presentation, 'page');
  if (!pages.length) invalid(`The ${LABEL} deck contains no slides.`);
  if (pages.length > MAX_SLIDES) invalid(`The ${LABEL} deck exceeds the ${MAX_SLIDES} slide limit.`);

  const deck: SlideDeck = { sourceFormat: 'odp', slides: [], unsupportedFeatures: [], truncated: false };
  let textBytes = 0;
  pages.forEach((page, index) => {
    const slide: Slide = { index, title: '', blocks: [], notes: '' };
    for (const frame of childElements(page, 'frame')) {
      if (slide.blocks.length >= MAX_BLOCKS_PER_SLIDE) {
        deck.truncated = true;
        deck.truncationReason = `The deck was truncated at ${MAX_BLOCKS_PER_SLIDE} text blocks per slide.`;
        break;
      }
      const text = frameText(frame);
      if (text === '') continue;
      const kind = frameKind(frame);
      slide.blocks.push({ kind, text });
      if (kind === 'title' && slide.title === '') slide.title = text.split('\n')[0];
      textBytes += text.length;
    }
    const notes = childElements(page, 'notes')[0];
    if (notes) {
      const notesParagraphs: string[] = [];
      for (const frame of descendants(notes, 'frame', LABEL)) {
        const text = frameText(frame);
        if (text !== '') notesParagraphs.push(text);
      }
      slide.notes = notesParagraphs.join('\n');
    }
    deck.slides.push(slide);
    if (textBytes > MAX_TEXT_BYTES) {
      deck.truncated = true;
      deck.truncationReason = 'The deck was truncated at the 1 MiB text limit.';
    }
  });
  return deck;
}
