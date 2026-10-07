// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEpubPages, extractPdfPages, readDocumentAttachment } from '../../electron/vault/document-preview';

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

function pdfWithPages(pages: { pageId: number; contentId: number; operators: string }[], pageOrder = pages) {
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${pageOrder.map(({ pageId }) => `${pageId} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`,
    ...pages.flatMap(({ pageId, contentId, operators }) => {
      const content = `BT ${operators} ET`;
      return [
        `${pageId} 0 obj << /Type /Page /Parent 2 0 R /Contents ${contentId} 0 R >> endobj`,
        `${contentId} 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
      ];
    }),
  ];
  return Buffer.from(`%PDF-1.7\n${objects.join('\n')}\n`, 'latin1');
}

describe('PDF and ePub extraction', () => {
  it('extracts literal and hex PDF text operators', () => {
    const pdf = pdfWithPages([{ pageId: 3, contentId: 4, operators: '(Hello\\040world) Tj <00410042> Tj' }]);
    expect(extractPdfPages(pdf)).toEqual(['Hello world AB']);
  });

  it('extracts text-array PDF operators with escaped delimiters', () => {
    const pdf = pdfWithPages([{ pageId: 3, contentId: 4, operators: '[(First) -20 (Second\\)part)] TJ' }]);
    expect(extractPdfPages(pdf)).toEqual(['FirstSecond)part']);
  });

  it('extracts referenced streams in page-tree order and skips unreferenced streams', () => {
    const pdf = pdfWithPages(
      [
        { pageId: 3, contentId: 4, operators: '(First page) Tj' },
        { pageId: 5, contentId: 6, operators: '(Second page) Tj' },
      ],
      [
        { pageId: 5, contentId: 6, operators: '' },
        { pageId: 3, contentId: 4, operators: '' },
      ],
    );
    const withUnreferencedText = Buffer.concat([
      pdf.subarray(0, -1),
      Buffer.from('9 0 obj << /Length 26 >> stream\nBT (Not a page) Tj ET\nendstream endobj\n', 'latin1'),
    ]);
    expect(extractPdfPages(withUnreferencedText)).toEqual(['Second page', 'First page']);
  });

  it('keeps PDFs without a page tree as one document-level text chunk', () => {
    const pdf = Buffer.from(
      '%PDF-1.7\n<< /Length 37 >>\nstream\nBT (First) Tj ET\fBT (Second) Tj ET\nendstream\n',
      'latin1',
    );
    expect(extractPdfPages(pdf)).toEqual(['First Second']);
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
