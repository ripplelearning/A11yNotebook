// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { docxSearchText, parseDocxStructure } from '../../electron/vault/docx-parser';

const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const typesNs = 'http://schemas.openxmlformats.org/package/2006/content-types';

function checksum(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Record<string, string | Buffer>, options: { symlink?: string } = {}) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const content = Buffer.isBuffer(source) ? source : Buffer.from(source);
    const compressed = deflateRawSync(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum(content), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(options.symlink === name ? 0x0314 : 20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(checksum(content), 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(content.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(options.symlink === name ? 0xa0000000 : 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralDirectory, end]);
}

function validEntries(
  document = `<w:document xmlns:w="${wordNs}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Simple text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
): Record<string, string | Buffer> {
  return {
    '[Content_Types].xml': `<Types xmlns="${typesNs}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${relNs}"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': document,
    'word/styles.xml': `<w:styles xmlns:w="${wordNs}"><w:style w:type="paragraph" w:styleId="CustomHeading"><w:name w:val="Custom Heading"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`,
    'word/numbering.xml': `<w:numbering xmlns:w="${wordNs}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/read" TargetMode="External"/><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>`,
    'word/media/image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Guide</dc:title><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Author</dc:creator><dcterms:created xmlns:dcterms="http://purl.org/dc/terms/">2026-01-01T00:00:00Z</dcterms:created></cp:coreProperties>',
  };
}

describe('bounded local DOCX parser', () => {
  it('extracts heading hierarchy, styled runs, nested lists, tables, links, images, breaks, and metadata', () => {
    const content = `<w:document xmlns:w="${wordNs}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="CustomHeading"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">A11y </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Notebook</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Nested item</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:hyperlink r:id="link"><w:r><w:t>Accessible link</w:t></w:r></w:hyperlink><w:r><w:drawing><wp:inline><wp:docPr descr="Helpful image description"/><a:graphic><a:graphicData><a:blip r:embed="image"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`;
    const structure = parseDocxStructure(zip(validEntries(content)));

    expect(structure).toMatchObject({
      title: 'Guide',
      author: 'Author',
      created: '2026-01-01T00:00:00.000Z',
      headings: [{ level: 2, text: 'A11y Notebook', blockIndex: 0 }],
      links: [{ text: 'Accessible link', target: 'https://example.org/read', blockIndex: 2 }],
      sectionCount: 1,
    });
    expect(structure.blocks[0]).toMatchObject({
      kind: 'paragraph',
      text: 'A11y Notebook',
      runs: [{ text: 'A11y ', bold: true }, { text: 'Notebook', italic: true }],
    });
    expect(structure.blocks[1]).toMatchObject({
      kind: 'paragraph',
      text: 'Nested item\n',
      list: { ordered: true, level: 1 },
      breaks: ['page'],
    });
    expect(structure.blocks[2]).toMatchObject({
      runs: [{ text: 'Accessible link', link: 'https://example.org/read' }, { image: { altText: 'Helpful image description', mediaType: 'image/png' } }],
    });
    expect(structure.blocks[3]).toMatchObject({
      kind: 'table',
      rows: [{ cells: [{ paragraphs: [{ text: 'Table cell text' }] }] }],
    });
    expect(docxSearchText(structure)).toContain('Table cell text');
  });

  it.each([
    ['traversal', { '../outside.xml': 'x' }],
    ['symlink', { 'word/document.xml': '<x/>' }],
    ['macro payload', { 'word/vbaProject.bin': 'payload' }],
    ['nested archive', { 'word/embeddings/inner.docx': 'payload' }],
  ])('rejects %s archive entries', (label, extra) => {
    const entries = { ...validEntries(), ...extra };
    expect(() => parseDocxStructure(zip(entries, label === 'symlink' ? { symlink: 'word/document.xml' } : {}))).toThrow();
  });

  it('rejects malformed, truncated, over-deep, and DTD-bearing XML', () => {
    expect(() => parseDocxStructure(zip({ ...validEntries(), '[Content_Types].xml': '<Types>' }))).toThrow(/malformed|nesting/i);
    const truncated = zip(validEntries()).subarray(0, zip(validEntries()).length - 8);
    expect(() => parseDocxStructure(truncated)).toThrow(/malformed or truncated/i);
    const deeplyNested = `<w:document xmlns:w="${wordNs}"><w:body>${'<x>'.repeat(130)}${'</x>'.repeat(130)}<w:sectPr/></w:body></w:document>`;
    expect(() => parseDocxStructure(zip(validEntries(deeplyNested)))).toThrow(/nesting|depth/i);
    const dtd = `<!DOCTYPE x [<!ENTITY a "expansion">]><w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>`;
    expect(() => parseDocxStructure(zip(validEntries(dtd)))).toThrow(/DTD|entity/i);
  });

  it('rejects external resources and unsafe hyperlink protocols', () => {
    const external = validEntries();
    external['word/_rels/document.xml.rels'] = `<Relationships xmlns="${relNs}"><Relationship Id="remote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.org/image.png" TargetMode="External"/></Relationships>`;
    expect(() => parseDocxStructure(zip(external))).toThrow(/External data|resources/i);
    const command = validEntries(
      `<w:document xmlns:w="${wordNs}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="link"><w:r><w:t>Run</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`,
    );
    command['word/_rels/document.xml.rels'] = `<Relationships xmlns="${relNs}"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`;
    expect(() => parseDocxStructure(zip(command))).toThrow(/unsupported|command-like/i);
  });

  it('supports UTF-16 XML parts and rejects decompressed entry bombs', () => {
    const entries = validEntries();
    entries['word/document.xml'] = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(
        `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Mixed encoding</w:t></w:r></w:p></w:body></w:document>`,
        'utf16le',
      ),
    ]);
    expect(parseDocxStructure(zip(entries)).blocks[0]).toMatchObject({ text: 'Mixed encoding' });
    expect(() => parseDocxStructure(zip({ ...validEntries(), 'word/large.xml': Buffer.alloc(21 * 1024 * 1024) }))).toThrow();
  });

  it('truncates paragraph extraction at the documented limit', () => {
    const paragraphs = Array.from({ length: 10_001 }, (_, index) => `<w:p><w:r><w:t>${index}</w:t></w:r></w:p>`).join('');
    const document = `<w:document xmlns:w="${wordNs}"><w:body>${paragraphs}</w:body></w:document>`;
    const structure = parseDocxStructure(zip(validEntries(document)));
    expect(structure.blocks).toHaveLength(10_000);
    expect(structure.truncated).toBe(true);
    expect(structure.truncationReason).toContain('10000');
  });
});
