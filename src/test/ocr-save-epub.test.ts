import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildOcrEpub } from '../renderer/features/previews/ocr-save';

/** A transparent 1x1 PNG, base64. */
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=';

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

const OPF =
  '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-book</dc:identifier><dc:title>Test Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="img1.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/></spine></package>';

const CHAPTER =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><p><img src="img1.png" alt=""/></p></body></html>';

async function imageOnlyEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/content.opf', OPF);
  zip.file('OEBPS/ch1.xhtml', CHAPTER);
  zip.file('OEBPS/img1.png', Uint8Array.from(atob(PIXEL_PNG_BASE64), (char) => char.charCodeAt(0)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Local file headers of a zip, in order: name + compression method (0 = stored). */
function localHeaders(bytes: Uint8Array): Array<{ name: string; method: number }> {
  const entries: Array<{ name: string; method: number }> = [];
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b || bytes[offset + 2] !== 0x03 || bytes[offset + 3] !== 0x04)
      break;
    const method = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const compressedLength =
      bytes[offset + 18] | (bytes[offset + 19] << 8) | (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    entries.push({ name, method });
    offset += 30 + nameLength + extraLength + compressedLength;
  }
  return entries;
}

describe('OCR ePub text injection', () => {
  it('appends recognized text to the image-only section', async () => {
    const bytes = await imageOnlyEpub();
    const saved = await buildOcrEpub(bytes, new Map([[0, 'HELLO\n\nWORLD']]));
    const zip = await new JSZip().loadAsync(saved);
    const chapter = await zip.file('OEBPS/ch1.xhtml')!.async('string');
    expect(chapter).toContain('data-a11y-ocr-text');
    expect(chapter).toContain('<p>HELLO</p>');
    expect(chapter).toContain('<p>WORLD</p>');
    // The book still opens: its spine still lists the chapter.
    expect(chapter).toContain('<img src="img1.png"');
  });

  it('keeps the mimetype first and stored, as the ePub format requires', async () => {
    const bytes = await imageOnlyEpub();
    const saved = await buildOcrEpub(bytes, new Map([[0, 'HELLO']]));
    const headers = localHeaders(saved);
    expect(headers[0]).toEqual({ name: 'mimetype', method: 0 });
  });

  it('escapes recognized text and leaves other sections alone', async () => {
    const bytes = await imageOnlyEpub();
    const saved = await buildOcrEpub(bytes, new Map([[0, 'A <b>bold</b> claim & more']]));
    const zip = await new JSZip().loadAsync(saved);
    const chapter = await zip.file('OEBPS/ch1.xhtml')!.async('string');
    expect(chapter).toContain('A &lt;b&gt;bold&lt;/b&gt; claim &amp; more');
    expect(chapter).not.toContain('<b>bold</b> claim');
  });
});
