import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertImportedBytes, readImport, readImportSource } from '../../electron/vault/import';
import { buildDocFixture } from './helpers/doc-fixture';
import { zip } from './test-zip';

const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function xlsxFixture(): Buffer {
  return zip({
    'xl/workbook.xml': `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${mainNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Rent</t></is></c></row></sheetData></worksheet>`,
  });
}

function pptxFixture(): Buffer {
  return zip({
    'ppt/presentation.xml': `<p:presentation xmlns:p="${presentationNs}" xmlns:r="${relsNs}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="rId2" Type="${relsNs}/slide" Target="slides/slide1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="${presentationNs}" xmlns:a="${drawingNs}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Budget Review</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  });
}

const assertCurrent = () => {};

async function writeTempFile(name: string, content: string | Buffer): Promise<string> {
  // The import guard rejects any symlinked ancestor, and on macOS the
  // system temp dir lives under the /var -> /private/var symlink, so
  // the test must use the canonical temp dir.
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'a11y-import-formats-'));
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

describe('spreadsheet and slide import', () => {
  it('imports a valid .xlsx file unchanged', async () => {
    const file = await writeTempFile('Budget.xlsx', xlsxFixture());
    const result = await readImportSource(file, assertCurrent);
    expect(result.equals(xlsxFixture())).toBe(true);
    const imported = await readImport(file, assertCurrent);
    expect(imported.extension).toBe('.xlsx');
  });

  it('imports a valid .pptx file unchanged', async () => {
    const file = await writeTempFile('Review.pptx', pptxFixture());
    const result = await readImport(file, assertCurrent);
    expect(result.extension).toBe('.pptx');
  });

  it('rejects a corrupt .xlsx file instead of importing it', async () => {
    const file = await writeTempFile('Broken.xlsx', 'not a spreadsheet');
    await expect(readImportSource(file, assertCurrent)).rejects.toThrow(/malformed or truncated/);
  });

  it('explains unreadable formats instead of failing generically', async () => {
    const cases: Array<[string, RegExp]> = [
      ['Budget.numbers', /Apple Numbers.*Export To, Excel/],
      ['Deck.key', /Apple Keynote.*Export To, PowerPoint/],
      ['Old.ppt', /old PowerPoint.*save it as .pptx/],
      ['Sheet.gsheet', /Google Sheets.*download it as .xlsx or .csv/],
      ['Deck.gslides', /Google Slides.*download it as .pptx/],
    ];
    for (const [name, pattern] of cases) {
      const file = await writeTempFile(name, 'placeholder');
      await expect(readImport(file, assertCurrent)).rejects.toThrow(pattern);
      await expect(readImportSource(file, assertCurrent)).rejects.toThrow(pattern);
    }
  });
});
