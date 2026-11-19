// Opens an ePub with epubjs 0.4.2 and adapts it to the EpubBook shape the
// reader works with. See src/types/epubjs.d.ts for why the adaptation is
// needed: epubjs 0.4.2's factory never opens the book itself, and the
// Epub/Book it hands back use different shapes than the reader expects
// (navigation items are {id, href, title, children}, not
// {label, href, subitems}, and nested entries are not resolved).
import type { EpubBook, EpubTocItem } from 'epubjs/src/index.js';
import JSZip from 'jszip';

/** Media types the reader can load as text sections and display. */
const HTML_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html']);

/**
 * Normalize a zip entry path: strip a leading slash, resolve `.` and `..`
 * segments, and percent-decode (epubjs looks entries up decoded, so a
 * manifest href of `My%20Chapter.xhtml` and a zip entry of
 * `My Chapter.xhtml` are the same file). Returns null when the path
 * escapes the archive root.
 */
function normalizeZipPath(path: string): string | null {
  let decoded = path.replace(/^\/+/, '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A malformed escape stays raw; the lookup below still tries it.
  }
  const parts: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

/**
 * Repair an ePub package before epubjs opens it, so one bad entry cannot
 * fail the whole book. epubjs 0.4.2 assumes every file the package
 * manifest names is present in the zip and every spine item is HTML:
 *
 * - `Archive.getText` returns `undefined` (not a rejected promise) for a
 *   missing entry, and `Resources.replacementHtml`/`replacementCss` call
 *   `.then` on it, throwing a synchronous TypeError that rejects the
 *   whole `replacements()` pass. `Epub.unpack` swallows that rejection
 *   and never assigns `epub.book`, so the open fails. A missing spine
 *   chapter, navigation file, or stylesheet kills the book this way.
 * - A missing navigation file (EPUB 3 nav, EPUB 2 NCX) rejects
 *   `loadNavigation` the same way, with the same swallowed result.
 * - `Resources.substitute` builds one regex from the replacement map and
 *   replaces through it; with an EMPTY map the regex is `()`, which
 *   matches at every position and inserts the string "undefined" between
 *   every character of the file. A book whose first stylesheet or chapter
 *   is substituted with an empty map therefore loads garbage — the
 *   chapter parses to a `<parsererror>` document with no `<head>`, and
 *   the section load throws "No Element Provided".
 * - A non-HTML spine item (typically an SVG cover) reaches
 *   `Section.load`, whose `replaceBase` content hook assumes an HTML
 *   document with a `<head>`; an SVG document has none, so the load
 *   throws "No Element Provided" and the reader's search-text loop
 *   fails the book. The rendition cannot display such a section either
 *   (its Contents assumes `document.body`).
 *
 * The repair stubs in a minimal valid file for every missing HTML, CSS,
 * or NCX entry (a missing chapter becomes a readable placeholder
 * section, so the spine and table of contents keep working), drops
 * non-HTML items from the spine, and — when the package has no asset
 * whose file exists — adds a one-pixel stub image, because epubjs
 * awaits the asset replacements before substituting, which guarantees
 * the substitute map is never empty. The file on disk is never
 * touched; only the in-memory copy the reader opens is repaired. A
 * well-formed book passes through byte-identical, and any failure in
 * the repair itself returns the original bytes, so a book the repair
 * cannot understand fails exactly as it did before.
 */
const NAV_STUB =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol></ol></nav></body></html>';
const CHAPTER_STUB =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Missing section</title></head><body><h1>Missing section</h1><p>This section is missing from the book.</p></body></html>';
const HTML_STUB =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Missing</title></head><body></body></html>';
const NCX_STUB =
  '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="repair"/></head><docTitle><text>Book</text></docTitle><navMap></navMap></ncx>';
/** A transparent 1x1 PNG, base64. */
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=';

export async function repairEpubPackage(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const zip = await new JSZip().loadAsync(bytes);
    const containerEntry = zip.file('META-INF/container.xml');
    if (!containerEntry) return bytes;
    const containerDoc = new DOMParser().parseFromString(await containerEntry.async('string'), 'text/xml');
    const rootfiles = containerDoc.getElementsByTagName('rootfile');
    const opfPath = rootfiles[0]?.getAttribute('full-path');
    if (!opfPath) return bytes;
    const opfEntry = zip.file(opfPath.replace(/^\/+/, '')) ?? zip.file(opfPath);
    if (!opfEntry) return bytes;
    const opfDoc = new DOMParser().parseFromString(await opfEntry.async('string'), 'text/xml');
    const manifests = opfDoc.getElementsByTagName('manifest');
    const spines = opfDoc.getElementsByTagName('spine');
    if (manifests.length === 0 || spines.length === 0) return bytes;
    const manifest = manifests[0];
    const spine = spines[0];
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const entryExists = (resolved: string | null): boolean => {
      if (resolved === null) return false;
      // The zip may store the name raw or percent-encoded; try both.
      return zip.file(resolved) !== null || zip.file(encodeURI(resolved)) !== null;
    };
    const spineIds = new Set<string>();
    for (const itemref of Array.from(spine.getElementsByTagName('itemref'))) {
      const idref = itemref.getAttribute('idref');
      if (idref) spineIds.add(idref);
    }

    // Stub in a minimal valid file for every missing HTML, CSS, or NCX
    // entry, so epubjs never trips over an absent file.
    let changed = false;
    for (const item of Array.from(manifest.getElementsByTagName('item'))) {
      const href = item.getAttribute('href');
      const id = item.getAttribute('id');
      const mediaType = item.getAttribute('media-type') ?? '';
      if (!href) continue;
      const resolved = normalizeZipPath(opfDir + href);
      if (entryExists(resolved) || resolved === null) continue;
      let stub: string | null = null;
      if (mediaType === 'application/xhtml+xml' || mediaType === 'text/html') {
        const properties = item.getAttribute('properties') ?? '';
        stub = properties.split(/\s+/).includes('nav')
          ? NAV_STUB
          : id !== null && spineIds.has(id)
            ? CHAPTER_STUB
            : HTML_STUB;
      } else if (mediaType === 'text/css') {
        stub = '';
      } else if (mediaType === 'application/x-dtbncx+xml') {
        stub = NCX_STUB;
      }
      // Other types (images, fonts, ...) are assets: epubjs already
      // tolerates a missing one, so leave the item as it is.
      if (stub === null) continue;
      zip.file(resolved, stub);
      changed = true;
    }

    // Drop spine entries pointing at non-HTML content the reader can
    // neither load as text nor display (typically an SVG cover).
    const manifestById = new Map<string, Element>();
    for (const item of Array.from(manifest.getElementsByTagName('item'))) {
      const id = item.getAttribute('id');
      if (id) manifestById.set(id, item);
    }
    for (const itemref of Array.from(spine.getElementsByTagName('itemref'))) {
      const idref = itemref.getAttribute('idref');
      if (!idref) continue;
      const item = manifestById.get(idref);
      const mediaType = item?.getAttribute('media-type') ?? '';
      if (!item || !HTML_MEDIA_TYPES.has(mediaType)) {
        itemref.parentNode?.removeChild(itemref);
        changed = true;
      }
    }

    // Guarantee epubjs's substitute map is never empty: the asset
    // replacements are awaited before any stylesheet or chapter is
    // substituted, so one existing asset keeps every file intact. A
    // package with no usable asset gets a one-pixel stub image.
    if (changed) {
      const hasUsableAsset = Array.from(manifest.getElementsByTagName('item')).some((item) => {
        const mediaType = item.getAttribute('media-type') ?? '';
        if (HTML_MEDIA_TYPES.has(mediaType) || mediaType === 'text/css') return false;
        const href = item.getAttribute('href');
        return href !== null && entryExists(normalizeZipPath(opfDir + href));
      });
      if (!hasUsableAsset) {
        let stubName = 'a11y-repair-pixel.png';
        let stubId = 'a11y-repair-pixel';
        for (let attempt = 2; attempt <= 10 && entryExists(normalizeZipPath(opfDir + stubName)); attempt += 1) {
          stubName = `a11y-repair-pixel-${attempt}.png`;
          stubId = `a11y-repair-pixel-${attempt}`;
        }
        if (!entryExists(normalizeZipPath(opfDir + stubName))) {
          const pixel = Uint8Array.from(atob(PIXEL_PNG_BASE64), (char) => char.charCodeAt(0));
          zip.file(normalizeZipPath(opfDir + stubName) ?? stubName, pixel);
          const stubItem = opfDoc.createElement('item');
          stubItem.setAttribute('id', stubId);
          stubItem.setAttribute('href', stubName);
          stubItem.setAttribute('media-type', 'image/png');
          manifest.appendChild(stubItem);
        }
      }
    }

    if (!changed) return bytes;
    zip.file(opfEntry.name, new XMLSerializer().serializeToString(opfDoc));
    return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  } catch {
    // Not a zip, or a package the repair cannot parse: hand the original
    // bytes to epubjs, which fails exactly as it did before the repair.
    return bytes;
  }
}

/** One raw table-of-contents entry from epubjs's Navigation. */
export interface EpubNavigationItemLike {
  id: string;
  href: string;
  title: string;
  children?: EpubNavigationItemLike[];
}

/**
 * Map epubjs navigation items to the reader's table-of-contents items.
 * epubjs keeps relative hrefs and calls the label `title`; nested entries
 * are not resolved, so every level is resolved here against the book's
 * resources. Resolved hrefs are the blob: URLs the spine sections use, so
 * a table-of-contents selection matches sections, and #anchors survive.
 */
export function mapEpubTocItems(
  items: EpubNavigationItemLike[],
  resolve: (href: string) => string,
): EpubTocItem[] {
  return items.map((item) => ({
    label: item.title,
    href: resolve(item.href),
    subitems:
      item.children && item.children.length > 0
        ? mapEpubTocItems(item.children, resolve)
        : undefined,
  }));
}

/**
 * Flatten a table of contents to section href -> label, for the reader's
 * section headings. epubjs resolves every spine href to a blob: URL when
 * it opens an archived book (Resources.replacements creates one blob URL
 * per HTML resource and toBook resolves spine hrefs through that cache),
 * so a section's href is "blob:<origin>/<uuid>" and its last segment is
 * the blob UUID — never a chapter name. The table of contents carries the
 * same resolved hrefs (see mapEpubTocItems), so it is the lookup key.
 * Fragments are stripped on both sides: a table-of-contents entry may
 * point at an anchor inside its section. The first entry for a section
 * wins, so a section keeps its chapter title rather than a subsection's.
 */
export function epubTocLabels(items: EpubTocItem[]): Map<string, string> {
  const labels = new Map<string, string>();
  const collect = (entries: EpubTocItem[]): void => {
    for (const entry of entries) {
      const key = entry.href.split('#')[0];
      if (!labels.has(key)) labels.set(key, entry.label);
      if (entry.subitems) collect(entry.subitems);
    }
  };
  collect(items);
  return labels;
}

/**
 * The display label for one spine section. Never derived from
 * section.href: that is a blob: URL whose last segment is the blob UUID
 * (see epubTocLabels). Prefer the table-of-contents title for the section,
 * then the section document's <title>, then the manifest file name, and
 * finally a plain "Section N".
 */
export function epubSectionLabel(
  section: { href: string; source?: string; index: number },
  title: string,
  tocLabels: ReadonlyMap<string, string>,
): string {
  const tocLabel = tocLabels.get(section.href.split('#')[0]);
  if (tocLabel) return tocLabel;
  if (title) return title;
  // section.source is the manifest href relative to the package
  // (epubjs sets it in toBook); a file name still beats a UUID.
  const fileName = section.source
    ?.split('/')
    .at(-1)
    ?.replace(/\.[^.]+$/, '');
  if (fileName) return fileName;
  return `Section ${section.index + 1}`;
}

/**
 * A section's accessible text and document title from its loaded
 * document. The <title> is metadata, not body text: it is returned
 * separately so it can head the section instead of repeating inside the
 * text, and so an image-only section that carries a <title> does not
 * report the title as its extractable text. A document with no <body>
 * falls back to the whole document's text.
 */
export function epubSectionText(content: Element): { text: string; title: string } {
  const normalize = (value: string | null | undefined): string => value?.replace(/\s+/g, ' ').trim() ?? '';
  // Real epubjs resolves section.load() to the document element, which has
  // querySelector; a minimal { textContent } shape (the shape the reader
  // tests mock) does not, so only use it when it exists instead of
  // throwing and losing the section's text.
  const querySelector =
    typeof content.querySelector === 'function' ? content.querySelector.bind(content) : null;
  const body = querySelector?.('body');
  return {
    text: normalize((body ?? content).textContent),
    title: normalize(querySelector?.('title')?.textContent),
  };
}
interface RenditionInternals {
  epubcfi: { isCfiString: (target: string) => boolean };
  spineByHref: Record<string, number>;
  spineBySource: Record<string, number>;
  spineById: Record<string, number>;
  manifest: { spine: Array<unknown> };
  findInSpine: (target: string | number) => unknown;
}

/**
 * Correct epubjs 0.4.2's Rendition.findInSpine on this rendition only.
 * Upstream resolves a href target with an || chain, so the first section
 * (index 0) reads as missing and display() rejects with "No Section
 * Found" — every book's opening section, and any table-of-contents entry
 * pointing at it. This is upstream's logic with index 0 preserved
 * (nullish checks instead of ||), so fragments still reach the view for
 * anchor jumps.
 */
export function patchFindInSpine(
  ePub: { CFI: new (cfi: string) => { spinePos: number } },
  rendition: ReturnType<EpubBook['renderTo']>,
): void {
  const internals = rendition as unknown as RenditionInternals;
  internals.findInSpine = function (this: RenditionInternals, target: string | number) {
    let index: number | undefined;
    if (this.epubcfi.isCfiString(target as string)) {
      index = new ePub.CFI(target as string).spinePos;
    } else if (typeof target === 'number' || isNaN(Number(target)) === false) {
      index = target as number;
    } else if (typeof target === 'string' && target.indexOf('#') === 0) {
      index = this.spineById[target.substring(1)];
    } else if (typeof target === 'string') {
      const href = target.split('#')[0];
      index =
        this.spineByHref[href] ??
        this.spineByHref[encodeURI(href)] ??
        this.spineBySource[href] ??
        this.spineBySource[encodeURI(href)];
    }
    return index === undefined ? null : (this.manifest.spine[index] ?? null);
  };
}

/**
 * Open an ePub from its bytes and return the reader's EpubBook.
 * epubjs 0.4.2's factory must be called with no arguments and the book
 * opened explicitly: ePub(buffer) treats the buffer as the options object
 * and never opens, so the book's navigation and spine are never assigned.
 */
export async function openEpubBook(bytes: Uint8Array): Promise<EpubBook> {
  const { default: ePub } = await import('epubjs/src/index.js');
  // epubjs 0.4.2 assumes every file the package manifest names is present
  // and every spine item is HTML; one bad entry fails the whole open (see
  // repairEpubPackage). Repair the in-memory copy first — a well-formed
  // book passes through unchanged.
  const repaired = await repairEpubPackage(bytes);
  bytes = repaired;
  // epubjs assumes a browser global `ePub`: the Contents constructor reads
  // ePub.VERSION with no guard, so displaying a section throws
  // "ReferenceError: ePub is not defined" in the bundled app, which has no
  // such global. Expose the factory as that global; it carries VERSION,
  // CFI, ViewManagers, and Views.
  (globalThis as { ePub?: typeof ePub }).ePub = ePub;
  const epub = await ePub();
  await epub.open(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const book = epub.book;
  if (!book) {
    throw new Error('ePub could not be opened');
  }
  const resolve = (href: string): string => {
    try {
      return epub.resources?.resolve(href) ?? href;
    } catch {
      return href;
    }
  };
  let rendition: ReturnType<EpubBook['renderTo']> | null = null;
  const adapter: EpubBook = {
    // book.sections is the real Spine instance, populated by the Book's
    // `spine` setter while the Epub was unpacked.
    spine: book.sections,
    // Read live from the Epub rather than snapshotted: navigation is
    // assigned by the async open, so the reader renders without a table
    // of contents until it arrives (see the guard in DocumentReader).
    get navigation() {
      return { toc: mapEpubTocItems(epub.navigation?.toc ?? [], resolve) };
    },
    renderTo(element, options) {
      // The bundled app has no global ePub, so epubjs cannot find its
      // view manager/view by name — pass the classes explicitly.
      rendition = new ePub.Rendition(book.manifest, {
        ...options,
        manager: ePub.ViewManagers['default'],
        view: ePub.Views['iframe'],
      });
      patchFindInSpine(ePub, rendition);
      rendition.attachTo(element);
      return rendition;
    },
    destroy() {
      try {
        rendition?.destroy();
      } catch {
        // Already torn down; nothing left to release.
      }
      rendition = null;
      // Mirror the factory's own teardown: the parsed Book and the Epub.
      book.destroy();
      epub.destroy();
    },
  };
  return adapter;
}
