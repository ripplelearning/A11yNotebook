// Opens an ePub with epubjs 0.4.2 and adapts it to the EpubBook shape the
// reader works with. See src/types/epubjs.d.ts for why the adaptation is
// needed: epubjs 0.4.2's factory never opens the book itself, and the
// Epub/Book it hands back use different shapes than the reader expects
// (navigation items are {id, href, title, children}, not
// {label, href, subitems}, and nested entries are not resolved).
import type { EpubBook, EpubTocItem } from 'epubjs/src/index.js';

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

/** The epubjs internals the findInSpine patch reads. */
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
