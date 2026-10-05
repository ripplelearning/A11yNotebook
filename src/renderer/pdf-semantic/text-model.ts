import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { ViewportTransform } from './viewport-transform';
import { explicitPdfArtifactType, type PdfArtifactType } from './reading-preferences';
import type { PdfAnnotationTarget } from '../../shared/pdf-annotation';
import { PDF_MALFORMED_GROUPED_TARGET_REASON, PDF_MALFORMED_TARGET_REASON } from '../../shared/pdf-annotation';

export type PdfTextPart = TextItem | (TextMarkedContent & { tag?: string | null });
export type TextCoordinates = [number, number, number, number];

export interface TextItemRange {
  extractionIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  markedContentId: string | null;
  artifactType?: PdfArtifactType;
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

export type PdfAnchorResolution =
  | {
      orphaned?: false;
      offset: number;
      page: number;
      length?: number;
      classification: Exclude<PdfAnnotationTarget['classification'], 'orphan'>;
      confidence: PdfAnnotationTarget['confidence'];
      verification: 'verified' | 'unverified';
      reason: string;
    }
  | {
      orphaned: true;
      classification: 'orphan';
      confidence: 'uncertain';
      verification?: 'verified' | 'unverified';
      reason: string;
    };

function validIdentity(identity: unknown): identity is PdfAnnotationTarget['documentIdentity'] {
  if (!identity || typeof identity !== 'object') return false;
  return ['fingerprint', 'fileHash', 'vaultPath'].every(
    (key) =>
      typeof (identity as Record<string, unknown>)[key] === 'string' &&
      (identity as Record<string, string>)[key].length > 0,
  );
}

export function isValidPdfAnchor(target: unknown): target is PdfAnnotationTarget {
  if (!target || typeof target !== 'object') return false;
  const value = target as PdfAnnotationTarget;
  return (
    value.kind === 'pdf' &&
    validIdentity(value.documentIdentity) &&
    Number.isSafeInteger(value.page) &&
    value.page > 0 &&
    Number.isSafeInteger(value.canonicalStart) &&
    value.canonicalStart >= 0 &&
    Number.isSafeInteger(value.canonicalLength) &&
    value.canonicalLength > 0 &&
    Number.isSafeInteger(value.canonicalStart + value.canonicalLength) &&
    ['exactQuote', 'normalizedQuote', 'contextBefore', 'contextAfter'].every(
      (key) => typeof (value as unknown as Record<string, unknown>)[key] === 'string',
    ) &&
    value.exactQuote.length > 0 &&
    value.exactQuote.length === value.canonicalLength &&
    value.normalizedQuote === normalize(value.exactQuote) &&
    ['exact', 'context-disambiguated', 'normalized', 'ambiguous', 'orphan'].includes(value.classification) &&
    ['certain', 'probable', 'uncertain'].includes(value.confidence) &&
    (value.verification === undefined || ['verified', 'unverified'].includes(value.verification)) &&
    (value.manuallyConfirmed === undefined || typeof value.manuallyConfirmed === 'boolean') &&
    (value.structPath === undefined || typeof value.structPath === 'string') &&
    (value.reason === undefined || typeof value.reason === 'string')
  );
}

export function malformedStoredAnchorResolution(target: PdfAnnotationTarget): PdfAnchorResolution | undefined {
  const reason = target.reason ?? '';
  const knownReason = [PDF_MALFORMED_TARGET_REASON, PDF_MALFORMED_GROUPED_TARGET_REASON].some((marker) =>
    reason.startsWith(marker),
  );
  if (
    target.classification !== 'orphan' ||
    (!knownReason && !/^Stored (?:grouped )?PDF target was malformed\b/u.test(reason))
  ) {
    return undefined;
  }
  return {
    orphaned: true,
    classification: 'orphan',
    confidence: 'uncertain',
    verification: 'unverified',
    reason,
  };
}

function normalize(value: string): string {
  return normalizedOffsets(value).text;
}

function normalizedOffsets(text: string): { text: string; offsets: number[]; ends: number[] } {
  let normalized = '';
  const offsets: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;

  for (const { segment, index } of new Intl.Segmenter().segment(text)) {
    const end = index + segment.length;
    const folded = segment
      .replace(/\u00ad/g, '')
      .normalize('NFKC')
      .toLowerCase();
    // Canonical offsets and string searches use UTF-16 units, including expansions and surrogate pairs.
    for (let unitIndex = 0; unitIndex < folded.length; unitIndex += 1) {
      const unit = folded[unitIndex];
      if (/\s/u.test(unit)) {
        if (normalized) pendingSpace = { start: pendingSpace?.start ?? index, end };
        continue;
      }
      if (pendingSpace) {
        normalized += ' ';
        offsets.push(pendingSpace.start);
        ends.push(pendingSpace.end);
        pendingSpace = undefined;
      }
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
  private identity?: PdfAnnotationTarget['documentIdentity'];

  constructor(
    pdfTextItems: PdfTextPart[],
    markedContentMap: Map<string, MarkedContentRange> = new Map(),
    view: [number, number, number, number] = [0, 0, 612, 792],
    page = 1,
    identity?: PdfAnnotationTarget['documentIdentity'],
  ) {
    this.view = view;
    this.page = page;
    if (identity) this.setDocumentIdentity(identity);
    this.markedContentMap = new Map(markedContentMap);
    const activeMarkedContent: string[] = [];
    const activeArtifacts: Array<PdfArtifactType | undefined> = [];
    const items: TextItemRange[] = [];
    let fullText = '';

    for (const [extractionIndex, part] of pdfTextItems.entries()) {
      if (!('str' in part)) {
        if (part.type === 'endMarkedContent') {
          activeMarkedContent.pop();
          activeArtifacts.pop();
        } else if (part.type === 'beginMarkedContentProps') {
          activeMarkedContent.push(typeof part.id === 'string' ? part.id : '');
          activeArtifacts.push(explicitPdfArtifactType(part.tag) ?? activeArtifacts.at(-1));
        } else if (part.type === 'beginMarkedContent') {
          activeMarkedContent.push('');
          activeArtifacts.push(explicitPdfArtifactType(part.tag) ?? activeArtifacts.at(-1));
        }
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
        artifactType: activeArtifacts.at(-1),
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

  get documentIdentity(): PdfAnnotationTarget['documentIdentity'] | undefined {
    return this.identity ? { ...this.identity } : undefined;
  }

  setDocumentIdentity(identity: PdfAnnotationTarget['documentIdentity']): void {
    if (!validIdentity(identity)) throw new TypeError('A complete PDF document identity is required.');
    this.identity = { ...identity };
  }

  createAnchor(pageNum: number, start: number, length: number): PdfAnnotationTarget {
    if (!this.identity) throw new Error('PDF document identity is required to create an annotation anchor.');
    if (
      pageNum !== this.page ||
      !Number.isSafeInteger(pageNum) ||
      pageNum < 1 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length <= 0 ||
      start + length > this.fullText.length
    ) {
      throw new RangeError('PDF annotation range must be within its canonical page text.');
    }
    const target: PdfAnnotationTarget = {
      kind: 'pdf',
      documentIdentity: { ...this.identity },
      page: pageNum,
      canonicalStart: start,
      canonicalLength: length,
      ...this.extractQuote(start, length),
      classification: 'exact',
      confidence: 'certain',
      verification: 'verified',
    };
    const resolution = this.resolveAnchor(target);
    return {
      ...target,
      classification: resolution.classification,
      confidence: resolution.confidence,
      ...(resolution.classification === 'ambiguous' ? { reason: resolution.reason } : {}),
    };
  }

  resolveAnchor(target: PdfAnnotationTarget): PdfAnchorResolution {
    if (!isValidPdfAnchor(target)) {
      return {
        orphaned: true,
        classification: 'orphan',
        confidence: 'uncertain',
        reason: 'Malformed PDF annotation target.',
      };
    }
    const malformedStored = malformedStoredAnchorResolution(target);
    if (malformedStored) return malformedStored;
    if (!this.identity) {
      return {
        orphaned: true,
        classification: 'orphan',
        confidence: 'uncertain',
        reason: 'PDF document identity is unavailable.',
      };
    }
    if (this.identity.vaultPath !== target.documentIdentity.vaultPath) {
      return {
        orphaned: true,
        classification: 'orphan',
        confidence: 'uncertain',
        verification: 'unverified',
        reason: 'PDF vault path does not match the annotation document identity.',
      };
    }
    const changed = this.identity.fileHash !== target.documentIdentity.fileHash;
    if (
      target.manuallyConfirmed === true &&
      target.verification === 'verified' &&
      !changed &&
      target.page === this.page &&
      this.fullText.slice(target.canonicalStart, target.canonicalStart + target.canonicalLength) === target.exactQuote
    ) {
      return {
        offset: target.canonicalStart,
        page: this.page,
        length: target.canonicalLength,
        classification: 'exact',
        confidence: 'certain',
        verification: 'verified',
        reason: 'Explicitly confirmed occurrence in unchanged PDF',
      };
    }
    const verification = changed || target.verification === 'unverified' ? 'unverified' : 'verified';
    const suffix = changed
      ? ' File hash changed; manual reconfirmation is required before highlighting.'
      : verification === 'unverified'
        ? ' Manual reconfirmation is required before highlighting.'
        : '';
    const result = (
      offset: number,
      length: number | undefined,
      classification: Exclude<PdfAnnotationTarget['classification'], 'orphan'>,
      reason: string,
    ): PdfAnchorResolution => ({
      offset,
      page: this.page,
      ...(length !== undefined ? { length } : {}),
      classification,
      confidence:
        classification === 'ambiguous'
          ? 'uncertain'
          : classification === 'normalized' || verification === 'unverified'
            ? 'probable'
            : 'certain',
      verification,
      reason: reason + suffix,
    });
    const exact: Array<{ startOffset: number; length: number }> = [];
    let index = 0;
    while ((index = this.fullText.indexOf(target.exactQuote, index)) !== -1) {
      exact.push({ startOffset: index, length: target.exactQuote.length });
      index += 1;
    }
    if (exact.length === 1)
      return result(exact[0].startOffset, exact[0].length, 'exact', 'Unique exact quote on this page.');
    const matches = exact.length ? exact : this.findText(target.normalizedQuote || target.exactQuote, true);
    if (matches.length === 1)
      return result(matches[0].startOffset, matches[0].length, 'normalized', 'Unique normalized quote on this page.');
    if (matches.length > 1) {
      const contextual = matches.filter(({ startOffset, length }) =>
        this.matchesContext(startOffset, length, target.contextBefore, target.contextAfter),
      );
      if (contextual.length === 1) {
        return result(
          contextual[0].startOffset,
          contextual[0].length,
          exact.length ? 'context-disambiguated' : 'normalized',
          'Quote uniquely identified by surrounding context.',
        );
      }
      return result(-1, undefined, 'ambiguous', 'Multiple quote matches remain; manual reconfirmation is required.');
    }
    return {
      orphaned: true,
      classification: 'orphan',
      confidence: 'uncertain',
      verification,
      reason: 'Quote not found on this page.' + suffix,
    };
  }

  offsetToCoordinates(offset: number, zoom?: number, rotation?: number): TextCoordinates | null;
  offsetToCoordinates(offset: number, length: number, zoom: number, rotation: number): TextCoordinates | null;
  offsetToCoordinates(
    offset: number,
    zoomOrLength = 1,
    rotationOrZoom = 0,
    rangeRotation?: number,
  ): TextCoordinates | null {
    const isRange = rangeRotation !== undefined;
    const zoom = isRange ? rotationOrZoom : zoomOrLength;
    const rotation = isRange ? rangeRotation : rotationOrZoom;
    const transform = new ViewportTransform(this.view, zoom, rotation);
    if (isRange) {
      const length = zoomOrLength;
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length <= 0 ||
        offset + length > this.fullText.length
      )
        return null;
      const rectangles = this.items.flatMap((item) => {
        if (!item.transform || item.endOffset <= offset || item.startOffset >= offset + length) return [];
        const textLength = Math.max(1, item.text.length - (item.hasEOL ? 1 : 0));
        const start = Math.min(textLength - 1, Math.max(0, offset - item.startOffset));
        const end = Math.min(textLength, Math.max(start + 1, offset + length - item.startOffset));
        return [this.itemCoordinates(item, start / textLength, end / textLength, transform)];
      });
      return rectangles.reduce<TextCoordinates | null>((bounds, rectangle) => {
        if (!bounds) return rectangle;
        const left = Math.min(bounds[0], rectangle[0]);
        const top = Math.min(bounds[1], rectangle[1]);
        const right = Math.max(bounds[0] + bounds[2], rectangle[0] + rectangle[2]);
        const bottom = Math.max(bounds[1] + bounds[3], rectangle[1] + rectangle[3]);
        return [left, top, right - left, bottom - top];
      }, null);
    }
    const item = this.items.find((candidate) => offset >= candidate.startOffset && offset < candidate.endOffset);
    if (!item?.transform) return null;
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

  findText(query: string, includeOverlapping = false): Array<{ startOffset: number; length: number; page: number }> {
    const needle = normalize(query);
    if (!needle) return [];
    const found: Array<{ startOffset: number; length: number; page: number }> = [];
    const canonicalRanges = new Set<string>();
    let index = 0;
    while ((index = this.normalizedText.indexOf(needle, index)) !== -1) {
      const startOffset = this.sourceOffsets[index];
      const endOffset = this.sourceEnds[index + needle.length - 1];
      const key = `${startOffset}:${endOffset}`;
      if (!includeOverlapping || !canonicalRanges.has(key)) {
        found.push({ startOffset, length: endOffset - startOffset, page: this.page });
        canonicalRanges.add(key);
      }
      index += includeOverlapping ? 1 : needle.length;
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
    if (!needle) return 'not found';
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
