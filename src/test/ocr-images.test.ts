import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { extractEpubSectionImages, extractPdfPageImages, readEpubSpine } from '../renderer/features/previews/ocr-images';
import type { PdfDocument } from '../renderer/pdf-semantic';

/** A transparent 1x1 PNG, base64. */
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=';

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

const OPF =
  '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-book</dc:identifier><dc:title>Test Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="img1.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>';

const CHAPTER_WITH_IMAGE =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><p><img src="img1.png" alt=""/></p></body></html>';
const CHAPTER_TEXT =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><p>Real text.</p></body></html>';

async function twoSectionEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/content.opf', OPF);
  zip.file('OEBPS/ch1.xhtml', CHAPTER_WITH_IMAGE);
  zip.file('OEBPS/ch2.xhtml', CHAPTER_TEXT);
  zip.file('OEBPS/img1.png', Uint8Array.from(atob(PIXEL_PNG_BASE64), (char) => char.charCodeAt(0)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('OCR image extraction', () => {
  it('lists the spine sections of an ePub in reading order', async () => {
    expect(await readEpubSpine(await twoSectionEpub())).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml']);
    expect(await readEpubSpine(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it('collects the embedded images of the wanted sections only', async () => {
    const bytes = await twoSectionEpub();
    const units = await extractEpubSectionImages(bytes, [0]);
    expect(units).toHaveLength(1);
    expect(units[0].index).toBe(0);
    expect(units[0].images).toHaveLength(1);
    expect(units[0].images[0]).toBeInstanceOf(Blob);
    expect((units[0].images[0] as Blob).type).toBe('image/png');
    // The text section has no images, so it yields no unit images.
    expect(await extractEpubSectionImages(bytes, [1])).toEqual([{ index: 1, images: [] }]);
  });

  it('renders the wanted PDF pages to canvases at OCR resolution', async () => {
    const renderCanvas = vi.fn(async (zoom: number, _rotation: number, maxScale: number) => {
      expect(zoom).toBe(3);
      expect(maxScale).toBe(3);
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 200;
      return canvas;
    });
    const pdfDocument = {
      getPage: vi.fn(async () => ({ renderCanvas })),
    } as unknown as PdfDocument;
    const units = await extractPdfPageImages(pdfDocument, [0, 2]);
    expect(units).toHaveLength(2);
    expect(units[0].index).toBe(0);
    expect(units[0].imageWidth).toBe(100);
    expect(units[0].imageHeight).toBe(200);
    expect(units[1].index).toBe(2);
    expect(pdfDocument.getPage).toHaveBeenCalledWith(1);
    expect(pdfDocument.getPage).toHaveBeenCalledWith(3);
  });
});
