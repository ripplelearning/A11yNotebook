import type { Element as XmlElement } from '@xmldom/xmldom';
import {
  childElements,
  descendants,
  elementText,
  parseXml,
} from './office-xml';
import { readZipEntries, type ZipEntry } from './zip-archive';
import type { Slide, SlideDeck, SlideTextBlock } from '../../src/shared/slides';

const LABEL = 'PPTX';
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NOTES_SLIDE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const MAX_SLIDES = 500;
const MAX_BLOCKS_PER_SLIDE = 200;
const MAX_TEXT_BYTES = 1024 * 1024;

function invalid(message: string): never {
  throw new Error(message);
}

function relId(element: XmlElement): string {
  return element.getAttributeNS(RELS_NS, 'id') || element.getAttribute('r:id') || '';
}

function parseRelationships(
  entries: Map<string, ZipEntry>,
  partPath: string,
): Map<string, string> {
  const targets = new Map<string, string>();
  const document = parseXml(entries, partPath, LABEL, false);
  if (!document || !document.documentElement) return targets;
  for (const rel of childElements(document.documentElement, 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) targets.set(id, target);
  }
  return targets;
}

function resolveTarget(sourcePart: string, target: string): string {
  const directory = sourcePart.includes('/') ? sourcePart.slice(0, sourcePart.lastIndexOf('/') + 1) : '';
  const joined = `${directory}${target.replace(/^\//, '')}`;
  const segments = joined.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '..') resolved.pop();
    else if (segment !== '.' && segment !== '') resolved.push(segment);
  }
  return resolved.join('/');
}

function shapeText(shape: XmlElement): string {
  const paragraphs: string[] = [];
  for (const txBody of descendants(shape, 'txBody', LABEL, 10)) {
    for (const paragraph of childElements(txBody, 'p')) {
      let text = '';
      for (const run of descendants(paragraph, 'r', LABEL)) {
        for (const t of childElements(run, 't')) text += t.textContent || '';
      }
      // Runs without an <a:r> wrapper (e.g. plain <a:t> children) still count.
      if (text === '') text = elementText(paragraph);
      paragraphs.push(text);
    }
  }
  return paragraphs.join('\n');
}

function placeholderKind(shape: XmlElement): SlideTextBlock['kind'] {
  const nvSpPr = descendants(shape, 'nvSpPr', LABEL, 10)[0];
  const nvPr = nvSpPr ? childElements(nvSpPr, 'nvPr')[0] : undefined;
  const ph = nvPr ? childElements(nvPr, 'ph')[0] : undefined;
  const type = ph?.getAttribute('type') || '';
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (type === 'body' || type === 'subTitle') return 'body';
  return 'other';
}

function parseSlide(
  entries: Map<string, ZipEntry>,
  partPath: string,
  index: number,
  state: { textBytes: number; truncated: boolean; truncationReason?: string },
): Slide {
  const document = parseXml(entries, partPath, LABEL);
  if (!document || !document.documentElement) invalid(`The ${LABEL} part ${partPath} is missing.`);
  const slide: Slide = { index, title: '', blocks: [], notes: '' };
  const shapes = descendants(document.documentElement, 'sp', LABEL);
  for (const shape of shapes) {
    if (slide.blocks.length >= MAX_BLOCKS_PER_SLIDE) {
      state.truncated = true;
      state.truncationReason = `The deck was truncated at ${MAX_BLOCKS_PER_SLIDE} text blocks per slide.`;
      break;
    }
    const text = shapeText(shape);
    if (text === '') continue;
    const kind = placeholderKind(shape);
    slide.blocks.push({ kind, text });
    if (kind === 'title' && slide.title === '') slide.title = text.split('\n')[0];
    state.textBytes += text.length;
    if (state.textBytes > MAX_TEXT_BYTES) {
      state.truncated = true;
      state.truncationReason = 'The deck was truncated at the 1 MiB text limit.';
      break;
    }
  }

  // Speaker notes live in a separate part linked from the slide's rels.
  const relsPath = partPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const notesRels = parseXml(entries, relsPath, LABEL, false);
  if (notesRels && notesRels.documentElement) {
    for (const rel of childElements(notesRels.documentElement, 'Relationship')) {
      if (rel.getAttribute('Type') !== NOTES_SLIDE_TYPE) continue;
      const target = rel.getAttribute('Target');
      if (!target) continue;
      const notesPath = resolveTarget(partPath, target);
      const notesDocument = parseXml(entries, notesPath, LABEL, false);
      if (!notesDocument || !notesDocument.documentElement) continue;
      const notesParagraphs: string[] = [];
      for (const shape of descendants(notesDocument.documentElement, 'sp', LABEL)) {
        // Skip the slide-image placeholder, which carries no text.
        const ph = descendants(shape, 'ph', LABEL, 10)[0];
        if (ph?.getAttribute('type') === 'sldImg') continue;
        const text = shapeText(shape);
        if (text !== '') notesParagraphs.push(text);
      }
      slide.notes = notesParagraphs.join('\n');
    }
  }
  return slide;
}

export function parsePptxDeck(bytes: Buffer): SlideDeck {
  const entries = readZipEntries(bytes, LABEL);
  const presentation = parseXml(entries, 'ppt/presentation.xml', LABEL);
  if (!presentation || !presentation.documentElement)
    invalid(`The ${LABEL} part ppt/presentation.xml is missing.`);
  const slideIdList = descendants(presentation.documentElement, 'sldIdLst', LABEL, 10)[0];
  const slideIds = slideIdList ? childElements(slideIdList, 'sldId') : [];
  if (!slideIds.length) invalid(`The ${LABEL} deck contains no slides.`);
  if (slideIds.length > MAX_SLIDES) invalid(`The ${LABEL} deck exceeds the ${MAX_SLIDES} slide limit.`);

  const rels = parseRelationships(entries, 'ppt/_rels/presentation.xml.rels');
  const state = { textBytes: 0, truncated: false, truncationReason: undefined as string | undefined };
  const deck: SlideDeck = { sourceFormat: 'pptx', slides: [], unsupportedFeatures: [], truncated: false };
  const usedPartPaths = new Set<string>();
  slideIds.forEach((slideId, index) => {
    const target = rels.get(relId(slideId));
    const partPath = target ? resolveTarget('ppt/presentation.xml', target) : `ppt/slides/slide${index + 1}.xml`;
    if (usedPartPaths.has(partPath)) invalid(`The ${LABEL} deck lists the same slide twice.`);
    usedPartPaths.add(partPath);
    if (!entries.has(partPath)) invalid(`The ${LABEL} part ${partPath} is missing.`);
    deck.slides.push(parseSlide(entries, partPath, index, state));
  });
  deck.truncated = state.truncated;
  if (state.truncationReason) deck.truncationReason = state.truncationReason;
  return deck;
}
