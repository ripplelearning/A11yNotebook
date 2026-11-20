/**
 * Regenerate the OCR E2E fixtures: image-only PDF and ePub files whose
 * only content is a rendered picture of the word "HELLO", plus a 12-page
 * image-only PDF for the cancel test. Run: `node e2e/fixtures/generate-ocr-fixtures.mjs`
 * from the repo root. Requires python3 + Pillow for the word image.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));

const PNG_SCRIPT = `
from PIL import Image, ImageDraw, ImageFont
import sys
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 220)
image = Image.new('RGB', (1400, 500), 'white')
draw = ImageDraw.Draw(image)
draw.text((120, 110), 'HELLO', fill='black', font=font)
image.save(sys.argv[1], 'PNG')
`;

function renderWordPng(outPath) {
  execFileSync('python3', ['-c', PNG_SCRIPT, outPath], { stdio: 'inherit' });
}

async function buildPdf(pngBytes, pageCount) {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(pngBytes);
  for (let page = 0; page < pageCount; page += 1) {
    const pageSize = [1400, 500];
    const pdfPage = doc.addPage(pageSize);
    pdfPage.drawImage(image, { x: 0, y: 0, width: 1400, height: 500 });
  }
  return doc.save();
}

async function buildEpub(pngBytes) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">ocr-fixture</dc:identifier><dc:title>OCR Fixture Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="img1.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/></spine></package>',
  );
  zip.file(
    'OEBPS/ch1.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><p><img src="img1.png" alt="A scanned page"/></p></body></html>',
  );
  zip.file('OEBPS/img1.png', pngBytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const pngPath = path.join(here, '.ocr-word.png');
renderWordPng(pngPath);
const { readFileSync, rmSync } = await import('node:fs');
const pngBytes = readFileSync(pngPath);
writeFileSync(path.join(here, 'ocr-image-only.pdf'), await buildPdf(pngBytes, 1));
writeFileSync(path.join(here, 'ocr-image-only-long.pdf'), await buildPdf(pngBytes, 12));
writeFileSync(path.join(here, 'ocr-image-only.epub'), await buildEpub(pngBytes));
rmSync(pngPath);
mkdirSync(here, { recursive: true });
