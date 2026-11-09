// epubjs 0.4.2 typings, corrected for the API the installed package actually
// exposes. The previous declaration described a fictional API
// (ePub(ArrayBuffer) returning a fully-opened Book with spine/navigation/
// renderTo) — the 0.3.x Book shape — which is why the reader compiled while
// the real integration was broken. In 0.4.2:
//   * ePub() with no arguments creates an Epub; the book is opened with
//     epub.open(input), which resolves after unpacking (navigation, book,
//     resources, and the spine are assigned by then).
//   * ePub(input) treats the input as the options object and never opens.
//   * the Epub exposes its parsed book as epub.book (a Book whose `spine`
//     setter populates book.sections, a real Spine instance) and its
//     navigation as epub.navigation (Navigation items: {id, href, title,
//     children}) — NOT the {label, href, subitems} shape the reader uses.
//   * a Rendition is built with new ePub.Rendition(manifest, options)
//     (manager/view classes passed explicitly, because the bundled app has
//     no global ePub for epubjs's requireManager to find).
// The reader's view of a book is EpubBook; src/renderer/features/previews/
// epub-book.ts opens the Epub and adapts it to that shape.
declare module 'epubjs/src/index.js' {
  interface EpubSection {
    index: number;
    href: string;
    load: () => Promise<Element>;
    hooks: {
      serialize: {
        register(callback: (this: { output: string }, content: string) => void): void;
      };
    };
  }

  interface EpubSpine {
    spineItems: EpubSection[];
  }

  export interface EpubTocItem {
    label: string;
    href: string;
    subitems?: EpubTocItem[];
  }

  interface EpubRendition {
    display: (target?: string | number) => Promise<unknown>;
    attachTo: (element: HTMLElement) => void;
    destroy: () => void;
  }

  /** The reader's view of an opened ePub, as produced by epub-book.ts. */
  export interface EpubBook {
    spine: EpubSpine;
    navigation: { toc: EpubTocItem[] };
    renderTo: (
      element: HTMLElement,
      options: { width: string; height: string; flow: 'paginated' },
    ) => EpubRendition;
    destroy: () => void;
  }

  /** One table-of-contents entry from epubjs 0.4.2's Navigation. */
  interface EpubNavigationItem {
    id: string;
    href: string;
    title: string;
    children: EpubNavigationItem[];
    parent?: string;
  }

  /** epubjs 0.4.2's Epub instance, once opened with epub.open(). */
  interface EpubInstance {
    open: (input: ArrayBuffer) => Promise<unknown>;
    readonly opened: Promise<unknown>;
    navigation?: { toc: EpubNavigationItem[] };
    book?: {
      sections: EpubSpine;
      manifest: { spine: Array<{ href: string }> };
      destroy: () => void;
    };
    resources?: { resolve: (path: string) => string };
    destroy: () => void;
  }

  /** epubjs 0.4.2's factory function (plus the classes it attaches). */
  interface EpubFactory {
    (): Promise<EpubInstance>;
    ViewManagers: Record<string, new (options: Record<string, unknown>) => unknown>;
    Views: Record<string, new (...args: never[]) => unknown>;
    Rendition: new (
      manifest: unknown,
      options: Record<string, unknown>,
    ) => EpubRendition;
  }

  const ePub: EpubFactory;
  export default ePub;
}
