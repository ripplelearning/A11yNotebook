// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractEpubPages, extractPdfPages, readDocumentAttachment } from '../../electron/vault/document-preview';
import { readImportSource } from '../../electron/vault/import';

function storedZip(entries: Record<string, string>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const content = Buffer.from(text);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, content);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(content.length, 20);
    record.writeUInt32LE(content.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + content.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function fontEncryption(algorithm = 'http://www.idpf.org/2008/embedding', uri = 'OPS/Fonts/Regular.otf') {
  return `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
}

function fontEpubEntries() {
  return {
    'META-INF/container.xml': '<container><rootfile full-path="OPS/book.opf"/></container>',
    'META-INF/encryption.xml': fontEncryption(),
    'OPS/book.opf':
      '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="font" href="Fonts/Regular.otf" media-type="font/otf"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    'OPS/chapter.xhtml': '<html><body><p>Readable book with an obfuscated font.</p></body></html>',
    'OPS/Fonts/Regular.otf': 'Obfuscated font resource',
  };
}

describe('PDF and ePub extraction', () => {
  it('rejects encrypted ePub package metadata before an explicit managed import', () => {
    const bytes = storedZip({ 'META-INF/encryption.xml': '<encryption/>' });
    expect(() => extractEpubPages(bytes, { forImport: true })).toThrow('Protected ePub');
  });

  it.each(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])(
    'imports standard font obfuscation without treating %s as DRM',
    async (algorithm) => {
      const entries = fontEpubEntries();
      entries['META-INF/encryption.xml'] = fontEncryption(algorithm);
      const bytes = storedZip(entries);
      expect(extractEpubPages(bytes, { forImport: true })).toEqual(['Readable book with an obfuscated font.']);
      const root = path.resolve(`.test-font-epub-${randomUUID()}`);
      await mkdir(root);
      try {
        const filename = path.join(root, 'Book.epub');
        await writeFile(filename, bytes);
        expect(await readImportSource(filename)).toEqual(bytes);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ['unknown encryption', fontEncryption('http://www.w3.org/2001/04/xmlenc#aes256-cbc')],
    ['content rather than a font', fontEncryption(undefined, 'OPS/chapter.xhtml')],
    ['a missing font', fontEncryption(undefined, 'OPS/Fonts/Missing.otf')],
    ['an escaping resource', fontEncryption(undefined, '../Regular.otf')],
    ['encoded traversal', fontEncryption(undefined, '%2e%2e/Regular.otf')],
    ['external resources', fontEncryption(undefined, 'https://example.test/Regular.otf')],
    ['malformed XML', fontEncryption().replace('</enc:CipherData>', '')],
    ['wrong namespaces', fontEncryption().replace('http://www.w3.org/2001/04/xmlenc#', 'urn:untrusted')],
    ['DTD declarations', '<!DOCTYPE encryption [<!ENTITY font "OPS/Fonts/Regular.otf">]>' + fontEncryption()],
    ['undeclared entities', fontEncryption(undefined, '&font;')],
    ['over-deep XML', '<a>'.repeat(65) + fontEncryption() + '</a>'.repeat(65)],
  ])('rejects %s during a managed ePub import', (_label, encryption) => {
    const entries = fontEpubEntries();
    entries['META-INF/encryption.xml'] = encryption;
    expect(() => extractEpubPages(storedZip(entries), { forImport: true })).toThrow('Protected ePub');
  });

  it('requires font media types and excludes resources used as reading content', () => {
    const entries = fontEpubEntries();
    entries['OPS/book.opf'] = entries['OPS/book.opf'].replace('media-type="font/otf"', 'media-type="text/html"');
    expect(() => extractEpubPages(storedZip(entries), { forImport: true })).toThrow('Protected ePub');
    entries['OPS/book.opf'] = fontEpubEntries()['OPS/book.opf'].replace('</spine>', '<itemref idref="font"/></spine>');
    expect(() => extractEpubPages(storedZip(entries), { forImport: true })).toThrow('Protected ePub');
    entries['OPS/book.opf'] = fontEpubEntries()['OPS/book.opf'].replace(
      'http://www.idpf.org/2007/opf',
      'urn:untrusted',
    );
    expect(() => extractEpubPages(storedZip(entries), { forImport: true })).toThrow('Protected ePub');
  });

  it('extracts literal and hex PDF text operators', () => {
    const pdf = Buffer.from(
      '%PDF-1.7\n<< /Length 28 >>\nstream\nBT (Hello\\040world) Tj <00410042> Tj ET\nendstream\n',
      'latin1',
    );
    expect(extractPdfPages(pdf)).toEqual(['Hello world AB']);
  });

  it('extracts text-array PDF operators with escaped delimiters', () => {
    const pdf = Buffer.from('%PDF-1.7\n[(First) -20 (Second\\)part)] TJ\n', 'latin1');
    expect(extractPdfPages(pdf)).toEqual(['FirstSecond)part']);
  });

  it('follows page-tree and content-array order, preserving blank pages and ignoring unrelated streams', () => {
    const pdf = Buffer.from(
      `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [7 0 R 2 0 R 3 0 R 9 0 R] >> endobj
3 0 obj << /Type /Page /Contents [4 0 R 5 0 R] >> endobj
4 0 obj << /Length 20 >> stream
BT (First) Tj ET
endstream endobj
5 0 obj << /Length 20 >> stream
BT (continued) Tj ET
endstream endobj
6 0 obj << /Length 20 >> stream
BT (Second) Tj ET
endstream endobj
7 0 obj << /Type /Pages /Kids [8 0 R] >> endobj
8 0 obj << /Type /Page /Contents 6 0 R >> endobj
9 0 obj << /Type /Page >> endobj
10 0 obj << /Length 20 >> stream
BT (Not a page) Tj ET
endstream endobj
`,
      'latin1',
    );
    expect(extractPdfPages(pdf)).toEqual(['Second', 'First continued', '']);
  });

  it('keeps unstructured PDF text as one document-level chunk rather than inventing pages', () => {
    const pdf = Buffer.from(
      '%PDF-1.7\n<< /Length 40 >> stream\nBT (First) Tj ET\fBT (Second) Tj ET\nendstream\n',
      'latin1',
    );
    expect(extractPdfPages(pdf)).toEqual(['First Second']);
  });

  it('decodes referenced Flate streams and skips unsupported filters', () => {
    const compressed = deflateSync(Buffer.from('BT (Compressed page) Tj ET'));
    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] >> endobj
3 0 obj << /Type /Page /Contents 4 0 R >> endobj
4 0 obj << /Filter /FlateDecode /Length ${compressed.length} >> stream\r\n`,
        'latin1',
      ),
      compressed,
      Buffer.from(
        '\r\nendstream endobj\n5 0 obj << /Type /Page /Contents 6 0 R >> endobj\n6 0 obj << /Filter /Unknown >> stream\nBT (Not decoded) Tj ET\nendstream endobj',
        'latin1',
      ),
    ]);
    expect(extractPdfPages(pdf)).toEqual(['Compressed page', '']);
  });

  it('extracts ePub content in package spine order and decodes entities', () => {
    const epub = storedZip({
      'META-INF/container.xml': '<container><rootfile full-path="OPS/book.opf"/></container>',
      'OPS/book.opf':
        '<package><manifest><item id="c2" href="chapter2.xhtml"/><item id="c1" href="chapter1.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      'OPS/chapter1.xhtml':
        '<html><body><h1>One</h1><p>Hello &amp; welcome</p><script>ignored()</script></body></html>',
      'OPS/chapter2.xhtml': '<html><body><p>Two &amp;lt;tag&gt;</p></body></html>',
    });
    expect(extractEpubPages(epub)).toEqual(['One\nHello & welcome', 'Two &lt;tag>']);
  });

  it('rejects malformed, unsupported, and oversized document input', async () => {
    expect(() => extractEpubPages(Buffer.from('not a zip'))).toThrow(/invalid/);
    expect(() => extractPdfPages(Buffer.from('not a PDF'))).toThrow(/invalid/);
    const root = await mkdtemp(path.join(os.tmpdir(), 'a11y-doc-preview-'));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, 'bad.pdf'), 'invalid');
      await expect(readDocumentAttachment(async (relative) => path.join(root, relative), 'bad.pdf')).rejects.toThrow(
        /invalid/,
      );
      await expect(readDocumentAttachment(async (relative) => path.join(root, relative), 'note.md')).rejects.toThrow(
        /Only PDF and ePub/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
