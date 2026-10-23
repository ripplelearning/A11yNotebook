import { describe, expect, it } from 'vitest';
import { formatPdfNotesExport } from '../shared/pdf-annotation-export';
import type { PdfAnnotation } from '../shared/pdf-annotation';

const note: PdfAnnotation = {
  id: 'one',
  path: 'Books/Report.pdf',
  target: {
    kind: 'pdf',
    documentIdentity: { fingerprint: 'fp', fileHash: 'hash', vaultPath: 'Books/Report.pdf' },
    page: 3,
    canonicalStart: 10,
    canonicalLength: 12,
    exactQuote: 'Original quote\nsecond line',
    normalizedQuote: 'original quote second line',
    contextBefore: '',
    contextAfter: '',
    classification: 'exact',
    confidence: 'certain',
    verification: 'verified',
  },
  color: 'yellow',
  label: 'Key finding',
  comment: 'Worth citing in the review.',
  createdAt: '2026-10-01T00:00:00.000Z',
  modifiedAt: '2026-10-01T00:00:00.000Z',
  schemaVersion: 1,
};

describe('PDF notes clipboard export', () => {
  it('keeps the original quote, comment, and status for each note', () => {
    const text = formatPdfNotesExport('Books/Report.pdf', [{ note, status: 'exact' }]);
    expect(text).toContain('PDF notes for Report.pdf');
    expect(text).toContain('## Key finding — page 3');
    expect(text).toContain('> Original quote\n> second line');
    expect(text).toContain('Comment: Worth citing in the review.');
    expect(text).toContain('Confidence: certain. Verification: verified.');
    expect(text).toContain('Location: exact');
  });

  it('defaults the label and reports grouped pages', () => {
    const grouped: PdfAnnotation = {
      ...note,
      label: '',
      comment: '',
      targets: [{ ...note.target, page: 5 }],
    };
    const text = formatPdfNotesExport('Books/Report.pdf', [{ note: grouped }]);
    expect(text).toContain('## PDF note — page 3, 5');
    expect(text).not.toContain('Comment:');
  });
});
