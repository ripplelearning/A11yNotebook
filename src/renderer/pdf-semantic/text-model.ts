import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { ViewportTransform } from './viewport-transform';

export type PdfTextPart = TextItem | (TextMarkedContent & { tag?: string | null });
export type TextCoordinates = [number, number, number, number];

export interface TextItemRange {
  extractionIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  markedContentId: string | null;
  hasEOL: boolean;
  transform?: number[];
  width: number;
  height: number;
}

export interface TextQuote {
  exactQuote: string;
  normalizedQuote: string;
  contextBefore: string;
  contextAfter: string;
}

export interface MarkedContentRange {
  startOffset: number;
  endOffset: number;
}

export type QuoteLocation = number | 'ambiguous' | 'not found';

function normalize(value: string): string {
  return value
    .replace(/\u00ad/g, '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

function normalizedOffsets(text: string): { text: string; offsets: number[]; ends: number[] } {
  let normalized = '';
  const offsets: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;

  for (const { segment, index } of new Intl.Segmenter().segment(text)) {
    const end = index + segment.length;
    if (segment === '\u00ad') {
      continue;
    }
    if (/^\s+$/u.test(segment)) {
      if (normalized) pendingSpace = { start: pendingSpace?.start ?? index, end };
      continue;
    }
    if (pendingSpace) {
      normalized += ' ';
      offsets.push(pendingSpace.start);
      ends.push(pendingSpace.end);
      pendingSpace = undefined;
    }
    const folded = segment.normalize('NFKC').toLocaleLowerCase();
    for (const unit of folded) {
      normalized += unit;
      offsets.push(index);
      ends.push(end);
    }
  }

  return { text: normalized, offsets, ends };
}

export class TextModel {
  readonly fullText: string;
  readonly normalizedText: string;
  readonly items: TextItemRange[];
  readonly markedContentMap: Map<string, MarkedContentRange>;
  readonly page: number;
  view: [number, number, number, number];
  private readonly sourceOffsets: number[];
  private readonly sourceEnds: number[];

  constructor(
    pdfTextItems: PdfTextPart[],
    markedContentMap: Map<string, MarkedContentRange> = new Map(),
    view: [number, number, number, number] = [0, 0, 612, 792],
    page = 1,
  ) {
    this.view = view;
    this.page = page;
    this.markedContentMap = new Map(markedContentMap);
    const activeMarkedContent: string[] = [];
    const items: TextItemRange[] = [];
    let fullText = '';

    for (const [extractionIndex, part] of pdfTextItems.entries()) {
      if (!('str' in part)) {
        if (part.type === 'endMarkedContent') activeMarkedContent.pop();
        else if (part.type === 'beginMarkedContentProps') {
          activeMarkedContent.push(typeof part.id === 'string' ? part.id : '');
        } else if (part.type === 'beginMarkedContent') activeMarkedContent.push('');
        continue;
      }

      const startOffset = fullText.length;
      const itemText = part.str + (part.hasEOL ? '\n' : '');
      fullText += itemText;
      items.push({
        extractionIndex,
        text: itemText,
        startOffset,
        endOffset: fullText.length,
        markedContentId: activeMarkedContent.at(-1) || null,
        hasEOL: part.hasEOL,
        transform: part.transform,
        width: part.width,
        height: part.height,
      });
    }

    this.fullText = fullText;
    this.items = items;
    const normalized = normalizedOffsets(fullText);
    this.normalizedText = normalized.text;
    this.sourceOffsets = normalized.offsets;
    this.sourceEnds = normalized.ends;

    for (const item of items) {
      if (!item.markedContentId) continue;
      const range = this.markedContentMap.get(item.markedContentId);
      this.markedContentMap.set(item.markedContentId, {
        startOffset: Math.min(range?.startOffset ?? item.startOffset, item.startOffset),
        endOffset: Math.max(range?.endOffset ?? item.endOffset, item.endOffset),
      });
    }
  }

  setView(view: [number, number, number, number]): void {
    this.view = view;
  }

  offsetToCoordinates(offset: number, zoom = 1, rotation = 0): TextCoordinates | null {
    const item = this.items.find((candidate) => offset >= candidate.startOffset && offset < candidate.endOffset);
    if (!item?.transform) return null;
    const [, , , , x, y] = item.transform;
    const transform = new ViewportTransform(this.view, zoom, rotation);
    const point = transform.pdfPoint(x, y);
    const bounds = transform.pdfRect(x, y, item.width, item.height || item.transform[0] || 12);
    return [point[0], point[1] - bounds[3], bounds[2], bounds[3]];
  }

  coordinatesToOffset(x: number, y: number, zoom = 1, rotation = 0): number | null {
    const transform = new ViewportTransform(this.view, zoom, rotation);
    let nearest: { offset: number; distance: number } | undefined;

    for (const item of this.items) {
      if (!item.transform || !item.text.length) continue;
      const [, , , , pdfX, pdfY] = item.transform;
      const bounds = transform.pdfRect(pdfX, pdfY, item.width, item.height || item.transform[0] || 12);
      const left = bounds[0];
      const top = bounds[1] - bounds[3];
      const right = left + bounds[2];
      const bottom = bounds[1];
      const dx = x < left ? left - x : x > right ? x - right : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const distance = dx * dx + dy * dy;
      if (!nearest || distance < nearest.distance) {
        const fraction =
          item.width && (transform.rotation === 90 || transform.rotation === 270)
            ? Math.max(0, Math.min(1, (transform.rotation === 90 ? y - top : bottom - y) / bounds[3]))
            : Math.max(0, Math.min(1, (transform.rotation === 180 ? right - x : x - left) / Math.max(bounds[2], 1)));
        nearest = {
          offset: Math.min(item.endOffset - 1, item.startOffset + Math.round(fraction * item.text.length)),
          distance,
        };
      }
    }

    return nearest?.offset ?? null;
  }

  extractQuote(startOffset: number, length: number): TextQuote {
    const start = Math.max(0, Math.min(this.fullText.length, startOffset));
    const end = Math.max(start, Math.min(this.fullText.length, start + Math.max(0, length)));
    return {
      exactQuote: this.fullText.slice(start, end),
      normalizedQuote: normalize(this.fullText.slice(start, end)),
      contextBefore: normalize(this.fullText.slice(Math.max(0, start - 80), start)),
      contextAfter: normalize(this.fullText.slice(end, Math.min(this.fullText.length, end + 80))),
    };
  }

  findText(query: string): Array<{ startOffset: number; length: number; page: number }> {
    const needle = normalize(query);
    if (!needle) return [];
    const found: Array<{ startOffset: number; length: number; page: number }> = [];
    let index = 0;
    while ((index = this.normalizedText.indexOf(needle, index)) !== -1) {
      const startOffset = this.sourceOffsets[index];
      const endOffset = this.sourceEnds[index + needle.length - 1];
      found.push({ startOffset, length: endOffset - startOffset, page: this.page });
      index += Math.max(needle.length, 1);
    }
    return found;
  }

  locateByQuote(exactQuote: string, contextBefore = '', contextAfter = ''): QuoteLocation {
    if (!exactQuote) return 'not found';
    const exactMatches: number[] = [];
    let index = 0;
    while ((index = this.fullText.indexOf(exactQuote, index)) !== -1) {
      exactMatches.push(index);
      index += 1;
    }
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) {
      const contextual = exactMatches.filter((start) =>
        this.matchesContext(start, exactQuote.length, contextBefore, contextAfter),
      );
      return contextual.length === 1 ? contextual[0] : 'ambiguous';
    }

    const needle = normalize(exactQuote);
    const contextualBefore = normalize(contextBefore);
    const contextualAfter = normalize(contextAfter);
    const normalized = normalizedOffsets(this.fullText);
    const matches: number[] = [];
    index = 0;
    while ((index = normalized.text.indexOf(needle, index)) !== -1) {
      const before = normalized.text.slice(Math.max(0, index - contextualBefore.length), index);
      const after = normalized.text.slice(index + needle.length, index + needle.length + contextualAfter.length);
      if (
        (!contextualBefore || before.endsWith(contextualBefore)) &&
        (!contextualAfter || after.startsWith(contextualAfter))
      ) {
        matches.push(normalized.offsets[index]);
      }
      index += Math.max(needle.length, 1);
    }
    return matches.length === 1 ? matches[0] : matches.length ? 'ambiguous' : 'not found';
  }

  private matchesContext(start: number, length: number, before: string, after: string): boolean {
    const quoteEnd = start + length;
    const beforeMatches = !before || normalize(this.fullText.slice(0, start)).endsWith(normalize(before));
    const afterMatches = !after || normalize(this.fullText.slice(quoteEnd)).startsWith(normalize(after));
    return beforeMatches && afterMatches;
  }
}
