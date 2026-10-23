import { describe, expect, it } from 'vitest';
import { isInternallySupportedPath } from '../shared/file-provenance';

describe('internal import compatibility', () => {
  it.each([
    'Note.md',
    'Note.HTML',
    'Page.htm',
    'Outline.outline.md',
    'Map.mindmap.json',
    'Study.cards.md',
    'Data.csv',
    'Data.grid.md',
    'Text.txt',
    'Book.epub',
    'Document.pdf',
    'Document.docx',
    'Letter.rtf',
    'Legacy.doc',
    'Image.jpeg',
  ])('offers explicit compatible import for %s', (path) => {
    expect(isInternallySupportedPath(path)).toBe(true);
  });

  it.each(['Program.exe', 'Archive.zip', 'Unknown.json', 'Note.md.exe', 'No extension'])(
    'does not offer internal import for %s',
    (path) => {
      expect(isInternallySupportedPath(path)).toBe(false);
    },
  );
});
