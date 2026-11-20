// Image extraction for whole-file OCR: one image per PDF page, and the
// embedded images of each ePub section.
//
// Only the units the caller names are extracted (the pages or sections
// with no extractable text): a page that already reads keeps its own
// text, so recognizing it would only waste the minutes a whole book
// already takes on-device.
import JSZip from 'jszip';
import { normalizeZipPath } from './epub-book';
import type { PdfDocument } from '../../pdf-semantic';
import type { OcrImageInput } from './ocr-engine';

/** One unit to recognize: its 0-based index and the images to read. */
export interface OcrUnitImages {
  index: number;
  images: OcrImageInput[];
}

/** Rendered size of a PDF page image, for mapping word boxes back to points. */
export interface OcrPdfPageImage extends OcrUnitImages {
  imageWidth: number;
  imageHeight: number;
}

/**
 * Render PDF pages to canvases for the recognizer. Scale 3 is about 216
 * DPI on a letter page — the recognizer's accuracy falls off below 200
 * DPI, and the render cap keeps a page under ~4 megapixels.
 */
export async function extractPdfPageImages(
  document: PdfDocument,
  wanted: ReadonlyArray<number>,
): Promise<OcrPdfPageImage[]> {
  const units: OcrPdfPageImage[] = [];
  for (const index of wanted) {
    const page = await document.getPage(index + 1);
    const canvas = await page.renderCanvas(3, 0, 3);
    units.push({ index, images: [canvas], imageWidth: canvas.width, imageHeight: canvas.height });
  }
  return units;
}

/** Image media types an ePub section can embed. */
const IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);

function zipPath(dir: string, href: string): string | null {
  return normalizeZipPath(`${dir}${href.split('#')[0].split('?')[0]}`);
}

/**
 * The spine section files of an ePub package, in reading order, as zip
 * paths. Reads container.xml and the package file straight from the
 * bytes; returns [] for a package that cannot be parsed.
 */
export async function readEpubSpine(bytes: Uint8Array): Promise<string[]> {
  try {
    const zip = await new JSZip().loadAsync(bytes);
    const containerEntry = zip.file('META-INF/container.xml');
    if (!containerEntry) return [];
    const containerDoc = new DOMParser().parseFromString(await containerEntry.async('string'), 'text/xml');
    const opfPath = containerDoc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
    if (!opfPath) return [];
    const opfEntry = zip.file(opfPath.replace(/^\/+/, ''));
    if (!opfEntry) return [];
    const opfDoc = new DOMParser().parseFromString(await opfEntry.async('string'), 'text/xml');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map<string, string>();
    for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) manifest.set(id, href);
    }
    const spine = opfDoc.getElementsByTagName('spine')[0];
    if (!spine) return [];
    const sections: string[] = [];
    for (const itemref of Array.from(spine.getElementsByTagName('itemref'))) {
      const href = manifest.get(itemref.getAttribute('idref') ?? '');
      if (!href) continue;
      const sectionPath = zipPath(opfDir, href);
      if (sectionPath) sections.push(sectionPath);
    }
    return sections;
  } catch {
    return [];
  }
}

/**
 * Collect the embedded images of each wanted ePub section, in spine
 * order. The package is read straight from the file's bytes (not through
 * epubjs, whose section hrefs are blob: URLs): container.xml names the
 * package file, the manifest maps ids to files, the spine orders the
 * sections, and each section's `<img>` elements name the images. SVG
 * images are skipped — the recognizer reads raster images, and an SVG
 * cover or diagram is usually vector content with its own text.
 */
export async function extractEpubSectionImages(
  bytes: Uint8Array,
  wanted: ReadonlyArray<number>,
): Promise<OcrUnitImages[]> {
  const wantedSet = new Set(wanted);
  const sections = await readEpubSpine(bytes);
  if (sections.length === 0) return [];
  let zip: JSZip;
  try {
    zip = await new JSZip().loadAsync(bytes);
  } catch {
    return [];
  }
  // Media type per zip path, for the image Blobs below.
  const mediaTypes = new Map<string, string>();
  const containerEntry = zip.file('META-INF/container.xml');
  const containerDoc = containerEntry
    ? new DOMParser().parseFromString(await containerEntry.async('string'), 'text/xml')
    : null;
  const opfPath = containerDoc?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (opfPath) {
    const opfEntry = zip.file(opfPath.replace(/^\/+/, ''));
    if (opfEntry) {
      const opfDoc = new DOMParser().parseFromString(await opfEntry.async('string'), 'text/xml');
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
        const href = item.getAttribute('href');
        const mediaType = item.getAttribute('media-type');
        if (!href || !mediaType) continue;
        const resolved = zipPath(opfDir, href);
        if (resolved) mediaTypes.set(resolved, mediaType);
      }
    }
  }
  const units: OcrUnitImages[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    if (!wantedSet.has(index)) continue;
    const sectionPath = sections[index];
    const sectionEntry = zip.file(sectionPath);
    if (!sectionEntry) continue;
    const sectionDir = sectionPath.includes('/') ? sectionPath.slice(0, sectionPath.lastIndexOf('/') + 1) : '';
    let sectionDoc: Document;
    try {
      sectionDoc = new DOMParser().parseFromString(await sectionEntry.async('string'), 'text/xml');
    } catch {
      continue;
    }
    const images: OcrImageInput[] = [];
    for (const img of Array.from(sectionDoc.getElementsByTagNameNS('*', 'img'))) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) continue;
      const imagePath = zipPath(sectionDir, src);
      if (!imagePath) continue;
      const imageEntry = zip.file(imagePath) ?? zip.file(encodeURI(imagePath));
      if (!imageEntry) continue;
      const mediaType = mediaTypes.get(imagePath) ?? 'image/png';
      if (!IMAGE_MEDIA_TYPES.has(mediaType) || mediaType === 'image/svg+xml') continue;
      const data = await imageEntry.async('uint8array');
      images.push(new Blob([new Uint8Array(data)], { type: mediaType }));
    }
    units.push({ index, images });
  }
  return units;
}
