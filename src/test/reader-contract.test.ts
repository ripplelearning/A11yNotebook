// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  READER_CAPABILITIES,
  REQUIRED_NOTE_READER_CAPABILITIES,
  capabilitiesMatch,
  getReaderContract,
  missingCapabilities,
} from '../shared/reader-contract';
import { formatNoteAnnotationsExport } from '../shared/note-annotation-export';
import type { NoteAnnotation } from '../shared/annotations';

describe('reader capability contract', () => {
  it('gives Markdown, HTML, and text note readers identical capability sets (parity)', () => {
    const markdown = getReaderContract('markdown-notes')!;
    const html = getReaderContract('html-notes')!;
    const text = getReaderContract('text-notes')!;
    expect(capabilitiesMatch(markdown, html)).toBe(true);
    expect(capabilitiesMatch(markdown, text)).toBe(true);
    expect(markdown.anchorKind).toBe('semantic-text');
    expect(html.anchorKind).toBe('semantic-text');
  });

  it('satisfies the required note-reader capabilities, with reading position the documented gap', () => {
    for (const format of ['markdown-notes', 'html-notes', 'text-notes']) {
      const reader = getReaderContract(format)!;
      expect(missingCapabilities(reader, REQUIRED_NOTE_READER_CAPABILITIES)).toEqual([]);
      expect(reader.capabilities['reading-position']).toBe(false);
    }
  });

  it('pins the staged gaps for the other adapters so closing them updates the contract', () => {
    const annotationSet = READER_CAPABILITIES.filter((capability) => capability.startsWith('annotation-'));
    expect(missingCapabilities(getReaderContract('epub')!, annotationSet)).toEqual(annotationSet);
    expect(missingCapabilities(getReaderContract('docx')!, annotationSet)).toEqual([]);
    expect(getReaderContract('epub')!.anchorKind).toBe('epub-cfi');
    expect(getReaderContract('docx')!.anchorKind).toBe('docx-paragraph-run');
    const pdf = getReaderContract('pdf')!;
    expect(pdf.anchorKind).toBe('pdf-page-range');
    expect(missingCapabilities(pdf, annotationSet)).toEqual([]);
    expect(pdf.capabilities['quote-export']).toBe(true);
    expect(pdf.capabilities.bookmarks).toBe(false);
  });
});

describe('note annotation export', () => {
  const annotation: NoteAnnotation = {
    id: 'a1',
    path: 'Notes/Trip.md',
    anchor: { quote: 'pack the tent', prefix: 'remember to ', suffix: ' and food', start: 12, end: 25 },
    color: 'yellow',
    label: 'Supplies',
    comment: 'Borrow one if needed.',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  };

  it('exports original quotes, comments, and per-annotation status', () => {
    const output = formatNoteAnnotationsExport('Notes/Trip.md', [
      { annotation, rendered: true },
      { annotation: { ...annotation, id: 'a2', label: 'Old', anchor: { ...annotation.anchor, quote: 'gone' } }, rendered: false },
    ]);
    expect(output).toContain('Annotations for Trip.md');
    expect(output).toContain('## Supplies (yellow highlight)');
    expect(output).toContain('> pack the tent');
    expect(output).toContain('Comment: Borrow one if needed.');
    expect(output).toContain('Status: Highlight shown in the reading view.');
    expect(output).toContain('Status: Highlight unavailable');
  });
});
