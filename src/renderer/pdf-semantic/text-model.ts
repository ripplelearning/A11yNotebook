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
    const transform = new ViewportTransform(this.view, zoom, rotation);
    const textLength = Math.max(1, item.text.length - (item.hasEOL ? 1 : 0));
    const characterOffset = Math.min(textLength - 1, Math.max(0, offset - item.startOffset));
    return this.itemCoordinates(item, characterOffset / textLength, (characterOffset + 1) / textLength, transform);
  }

  coordinatesToOffset(x: number, y: number, zoom = 1, rotation = 0): number | null {
    const transform = new ViewportTransform(this.view, zoom, rotation);
    let nearest: { offset: number; distance: number } | undefined;

    for (const item of this.items) {
      if (!item.transform || !item.text.length) continue;
      const bounds = this.itemCoordinates(item, 0, 1, transform);
      const [a, b, , , pdfX, pdfY] = item.transform;
      const baselineLength = Math.hypot(a, b) || 1;
      const origin = transform.pdfPoint(pdfX, pdfY);
      const endpoint = transform.pdfPoint(
        pdfX + (a / baselineLength) * item.width,
        pdfY + (b / baselineLength) * item.width,
      );
      const baselineX = endpoint[0] - origin[0];
      const baselineY = endpoint[1] - origin[1];
      const baselineSquare = baselineX * baselineX + baselineY * baselineY;
      const fraction =
        baselineSquare > 0
          ? Math.max(0, Math.min(1, ((x - origin[0]) * baselineX + (y - origin[1]) * baselineY) / baselineSquare))
          : 0;
      const left = bounds[0];
      const top = bounds[1];
      const right = left + bounds[2];
      const bottom = top + bounds[3];
      const dx = x < left ? left - x : x > right ? x - right : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const distance = dx * dx + dy * dy;
      if (!nearest || distance < nearest.distance) {
        const textLength = Math.max(1, item.text.length - (item.hasEOL ? 1 : 0));
        nearest = {
          offset: Math.min(item.endOffset - 1, item.startOffset + Math.floor(fraction * textLength)),
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

  private itemCoordinates(
    item: TextItemRange,
    startFraction: number,
    endFraction: number,
    viewport: ViewportTransform,
  ): TextCoordinates {
    const [a, b, c, d, x, y] = item.transform!;
    const baselineLength = Math.hypot(a, b) || 1;
    const verticalLength = Math.hypot(c, d) || 1;
    const baselineX = a / baselineLength;
    const baselineY = b / baselineLength;
    const verticalX = (c / verticalLength) * (item.height || verticalLength);
    const verticalY = (d / verticalLength) * (item.height || verticalLength);
    const startX = x + baselineX * item.width * startFraction;
    const startY = y + baselineY * item.width * startFraction;
    const endX = x + baselineX * item.width * endFraction;
    const endY = y + baselineY * item.width * endFraction;
    const corners = [
      viewport.pdfPoint(startX, startY),
      viewport.pdfPoint(endX, endY),
      viewport.pdfPoint(startX + verticalX, startY + verticalY),
      viewport.pdfPoint(endX + verticalX, endY + verticalY),
    ];
    const xs = corners.map(([pointX]) => pointX);
    const ys = corners.map(([, pointY]) => pointY);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
  }
}
