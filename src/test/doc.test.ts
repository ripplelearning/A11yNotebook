import { describe, expect, it } from 'vitest';
import { extractDocText, isDocSource } from '../../electron/vault/doc';
import { buildDocFixture } from './helpers/doc-fixture';

describe('legacy .doc text extraction', () => {
  it('extracts compressed and uncompressed pieces with paragraph breaks', () => {
    const bytes = buildDocFixture([
      { text: 'Dear reader,\rThis letter was saved by Word 2003.\r', compressed: true },
      { text: 'Second section with ünicode.\r', compressed: false },
    ]);
    expect(extractDocText(bytes)).toBe(
      'Dear reader,\nThis letter was saved by Word 2003.\nSecond section with ünicode.',
    );
  });

  it('recognizes the CFB signature', () => {
    expect(isDocSource(buildDocFixture([{ text: 'Hello', compressed: true }]))).toBe(true);
    expect(isDocSource(Buffer.from('plain bytes'))).toBe(false);
  });

  it('rejects files that are not CFB containers', () => {
    expect(() => extractDocText(Buffer.from('not a document at all'))).toThrow(/not a Word .doc document/);
  });

  it('rejects CFB containers whose document stream is not a Word document', () => {
    const bytes = buildDocFixture([{ text: 'Hello', compressed: true }], { wordIdent: 0x1234 });
    expect(() => extractDocText(bytes)).toThrow(/not a Word 97-2003 document/);
  });
});
