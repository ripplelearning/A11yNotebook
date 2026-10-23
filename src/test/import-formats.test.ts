import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertImportedBytes, readImport, readImportSource } from '../../electron/vault/import';
import { buildDocFixture } from './helpers/doc-fixture';

const assertCurrent = () => {};

async function writeTempFile(name: string, content: string | Buffer): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'a11y-import-formats-'));
  const file = path.join(directory, name);
  await writeFile(file, content);
  return file;
}

describe('RTF and legacy .doc import', () => {
  it('converts RTF bytes to a sanitized standalone HTML note', () => {
    const rtf = '{\\rtf1\\ansi{\\stylesheet{\\s1 heading 1;}}\\pard\\s1 My Title\\par\\pard Body \\b text\\b0.\\par}';
    const converted = convertImportedBytes('Letter.rtf', Buffer.from(rtf, 'latin1'));
    expect(converted.extension).toBe('.html');
    const html = converted.bytes.toString('utf8');
    expect(html).toContain('<h1>My Title</h1>');
    expect(html).toContain('<strong>text</strong>');
  });

  it('converts .doc bytes to an editable text note', () => {
    const doc = buildDocFixture([{ text: 'Legacy letter body.\rSecond paragraph.', compressed: true }]);
    const converted = convertImportedBytes('Letter.doc', doc);
    expect(converted.extension).toBe('.txt');
    expect(converted.bytes.toString('utf8')).toBe('Legacy letter body.\nSecond paragraph.');
  });

  it('imports an RTF file through readImport as HTML', async () => {
    const file = await writeTempFile('Notes.rtf', '{\\rtf1\\ansi\\pard Hello from RTF.\\par}');
    const result = await readImport(file, assertCurrent);
    expect(result.extension).toBe('.html');
    expect(result.bytes.toString('utf8')).toContain('<p>Hello from RTF.</p>');
  });

  it('imports a .doc file through readImport as text', async () => {
    const file = await writeTempFile('Old.doc', buildDocFixture([{ text: 'Archived text.', compressed: true }]));
    const result = await readImport(file, assertCurrent);
    expect(result.extension).toBe('.txt');
    expect(result.bytes.toString('utf8')).toBe('Archived text.');
  });

  it('explains Google Docs pointer files instead of failing generically', async () => {
    const file = await writeTempFile('Shared.gdoc', '{"url": "https://docs.google.com/document/d/abc"}');
    await expect(readImport(file, assertCurrent)).rejects.toThrow(/contains no document text/);
    await expect(readImportSource(file, assertCurrent)).rejects.toThrow(/download it as/);
  });

  it('rejects a .doc file without the Word container signature', async () => {
    const file = await writeTempFile('Fake.doc', 'definitely not a word document');
    await expect(readImportSource(file, assertCurrent)).rejects.toThrow(/not a Word .doc document/);
  });

  it('rejects an .rtf file without the RTF header', async () => {
    const file = await writeTempFile('Fake.rtf', 'plain text wearing a costume');
    await expect(readImportSource(file, assertCurrent)).rejects.toThrow(/does not contain valid RTF data/);
  });
});
