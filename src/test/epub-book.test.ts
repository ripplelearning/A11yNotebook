import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { EpubBook } from 'epubjs/src/index.js';
import {
  epubInitialSectionIndex,
  epubSectionLabel,
  epubSectionText,
  epubTocLabels,
  mapEpubTocItems,
  openEpubBook,
  patchFindInSpine,
  repairEpubPackage,
} from '../renderer/features/previews/epub-book';
import { zip } from './test-zip';

// ---------------------------------------------------------------------------
// Real-epubjs open tests. jsdom's own XMLHttpRequest cannot fetch blob:
// URLs (every section load fails with status 0), and jsdom's Blob has
// neither .text() nor .arrayBuffer(), so the tests install a blob-aware
// XHR that serves the blobs epubjs creates via URL.createObjectURL
// (read back with FileReader) and delegates anything else to the real XHR.
// ---------------------------------------------------------------------------
const blobStore = new Map<string, Blob>();
let blobCounter = 0;
URL.createObjectURL = (blob: Blob): string => {
  // Chromium returns blob:<origin>/<uuid>; the mock mirrors that shape
  // (deterministic per counter) so a label derived from a blob URL shows
  // up as a UUID here exactly as it does in the app.
  const url = `blob:mock/00000000-0000-4000-8000-${String(++blobCounter).padStart(12, '0')}`;
  blobStore.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url: string): void => {
  blobStore.delete(url);
};

const RealXHR = globalThis.XMLHttpRequest;
class BlobXHR {
  static UNSENT = 0;
  static OPENED = 1;
  static HEADERS_RECEIVED = 2;
  static LOADING = 3;
  static DONE = 4;
  onreadystatechange: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 0;
  status = 0;
  response: string | null = null;
  responseText: string | null = null;
  responseXML: Document | null = null;
  responseType = '';
  withCredentials = false;
  private url = '';
  private isBlob = false;

  open(_method: string, url: string): void {
    this.url = url;
    this.isBlob = url.startsWith('blob:mock/');
  }

  setRequestHeader(): void {
    // No-op: the mock ignores headers.
  }

  overrideMimeType(): void {
    // No-op: the mock ignores MIME overrides.
  }

  send(): void {
    if (!this.isBlob) {
      const real = new RealXHR();
      real.onreadystatechange = () => {
        this.readyState = real.readyState;
        this.status = real.status;
        this.response = real.response as string;
        this.responseText = real.responseText;
        this.responseXML = real.responseXML;
        this.onreadystatechange?.();
      };
      real.onerror = (e) => this.onerror?.(e);
      real.open('GET', this.url);
      real.send();
      return;
    }
    const blob = blobStore.get(this.url);
    void (async () => {
      if (!blob) {
        this.status = 404;
        this.readyState = 4;
        this.onreadystatechange?.();
        return;
      }
      // jsdom's Blob has neither .text() nor .arrayBuffer().
      const text = await new Promise<string>((resolvePromise, rejectPromise) => {
        const reader = new FileReader();
        reader.onload = () => resolvePromise(reader.result as string);
        reader.onerror = () => rejectPromise(reader.error ?? new Error('FileReader failed'));
        reader.readAsText(blob);
      });
      this.response = text;
      this.responseText = text;
      this.status = 200;
      this.readyState = 4;
      this.onreadystatechange?.();
    })();
  }
}
globalThis.XMLHttpRequest = BlobXHR as unknown as typeof XMLHttpRequest;

const CONTAINER_OPF = `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function epub3Entries(overrides: Record<string, string | Buffer | undefined> = {}): Record<string, string | Buffer> {
  const base: Record<string, string | Buffer> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER_OPF,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter1"/></spine></package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter One</a></li></ol></nav></body></html>`,
    'OEBPS/chapter1.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>The first chapter body text for testing.</p></body></html>`,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

function epub2Entries(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter1"/></spine></package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:test-book"/></head><docTitle><text>Test Book</text></docTitle><navMap><navPoint id="chapter1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="chapter1.xhtml"/></navPoint></navMap></ncx>`,
    'OEBPS/chapter1.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>The first chapter body text for testing.</p></body></html>`,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

// Tiny 1x1 JPEG (baseline, valid).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==',
  'base64',
);

/** Load every section the way the reader's search-text loop does. */
async function loadSectionTexts(book: EpubBook): Promise<string[]> {
  const texts: string[] = [];
  for (const section of book.spine.spineItems) {
    const content = await section.load();
    texts.push(content.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }
  return texts;
}

describe('repairEpubPackage', () => {
  it('leaves a well-formed book byte-identical', async () => {
    const bytes = new Uint8Array(zip(epub3Entries()));
    await expect(repairEpubPackage(bytes)).resolves.toBe(bytes);
  });

  it('returns non-zip bytes unchanged', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(repairEpubPackage(bytes)).resolves.toBe(bytes);
  });

  it('stubs in a missing navigation file instead of dropping it', async () => {
    const bytes = new Uint8Array(zip(epub3Entries({ 'OEBPS/nav.xhtml': undefined })));
    const repaired = await repairEpubPackage(bytes);
    expect(repaired).not.toBe(bytes);
    const zipContents = await new JSZip().loadAsync(repaired);
    const nav = await zipContents.file('OEBPS/nav.xhtml')?.async('string');
    expect(nav).toContain('<nav epub:type="toc">');
    const opf = await zipContents.file('OEBPS/content.opf')?.async('string');
    expect(opf).toContain('href="nav.xhtml"');
  });

  it('stubs in a missing NCX file for EPUB 2', async () => {
    const bytes = new Uint8Array(zip(epub2Entries({ 'OEBPS/toc.ncx': undefined })));
    const repaired = await repairEpubPackage(bytes);
    expect(repaired).not.toBe(bytes);
    const zipContents = await new JSZip().loadAsync(repaired);
    const ncx = await zipContents.file('OEBPS/toc.ncx')?.async('string');
    expect(ncx).toContain('<navMap>');
  });

  it('drops a non-HTML spine item from the spine', async () => {
    const bytes = new Uint8Array(
      zip(
        epub3Entries({
          'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.svg" media-type="image/svg+xml"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover"/><itemref idref="chapter1"/></spine></package>`,
          'OEBPS/cover.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="50">Cover art</text></svg>`,
        }),
      ),
    );
    const repaired = await repairEpubPackage(bytes);
    const zipContents = await new JSZip().loadAsync(repaired);
    const opf = (await zipContents.file('OEBPS/content.opf')?.async('string')) ?? '';
    expect(opf).not.toContain('idref="cover"');
    expect(opf).toContain('idref="chapter1"');
    // The SVG file itself stays in the package; only the spine loses it.
    expect(zipContents.file('OEBPS/cover.svg')).not.toBeNull();
  });
});

describe('openEpubBook with real epubjs', () => {
  it('opens a well-formed EPUB 3 and loads its chapter', async () => {
    const book = await openEpubBook(new Uint8Array(zip(epub3Entries())));
    try {
      expect(book.spine.spineItems).toHaveLength(1);
      expect(book.navigation.toc).toHaveLength(1);
      expect(book.navigation.toc[0].label).toBe('Chapter One');
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
    } finally {
      book.destroy();
    }
  });

  it('opens a book whose spine chapter file is missing, as a placeholder section', async () => {
    const book = await openEpubBook(
      new Uint8Array(
        zip(
          epub3Entries({
            'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter1"/><itemref idref="chapter2"/></spine></package>`,
          }),
        ),
      ),
    );
    try {
      expect(book.spine.spineItems).toHaveLength(2);
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
      expect(texts[1]).toContain('This section is missing from the book.');
    } finally {
      book.destroy();
    }
  });

  it('opens a book whose navigation file is missing, with an empty table of contents', async () => {
    const book = await openEpubBook(new Uint8Array(zip(epub3Entries({ 'OEBPS/nav.xhtml': undefined }))));
    try {
      expect(book.navigation.toc).toEqual([]);
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
    } finally {
      book.destroy();
    }
  });

  it('opens an EPUB 2 book whose NCX file is missing, with an empty table of contents', async () => {
    const book = await openEpubBook(new Uint8Array(zip(epub2Entries({ 'OEBPS/toc.ncx': undefined }))));
    try {
      expect(book.navigation.toc).toEqual([]);
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
    } finally {
      book.destroy();
    }
  });

  it('opens a book whose stylesheet is missing', async () => {
    const book = await openEpubBook(
      new Uint8Array(
        zip(
          epub3Entries({
            'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter1"/></spine></package>`,
          }),
        ),
      ),
    );
    try {
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
    } finally {
      book.destroy();
    }
  });

  it('opens a book with an SVG cover in the spine, without the SVG section', async () => {
    const book = await openEpubBook(
      new Uint8Array(
        zip(
          epub3Entries({
            'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.svg" media-type="image/svg+xml"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover"/><itemref idref="chapter1"/></spine></package>`,
            'OEBPS/cover.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="50">Cover art</text></svg>`,
          }),
        ),
      ),
    );
    try {
      expect(book.spine.spineItems).toHaveLength(1);
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
    } finally {
      book.destroy();
    }
  });

  it('opens a book with an image in the spine, without the image section', async () => {
    const book = await openEpubBook(
      new Uint8Array(
        zip(
          epub3Entries({
            'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="photo" href="photo.jpg" media-type="image/jpeg"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="photo"/><itemref idref="chapter1"/></spine></package>`,
            'OEBPS/photo.jpg': TINY_JPEG,
          }),
        ),
      ),
    );
    try {
      expect(book.spine.spineItems).toHaveLength(1);
      const texts = await loadSectionTexts(book);
      expect(texts[0]).toContain('The first chapter body text for testing.');
    } finally {
      book.destroy();
    }
  });

  it('rejects bytes that are not an ePub', async () => {
    await expect(openEpubBook(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});


/** The reader's section loop from DocumentReader.tsx, via the helpers. */
async function loadReaderSections(book: EpubBook): Promise<Array<{ label: string; text: string }>> {
  const tocLabels = epubTocLabels(book.navigation.toc);
  const loaded: Array<{ label: string; text: string }> = [];
  for (const section of book.spine.spineItems) {
    let text = '';
    let title = '';
    try {
      const extracted = epubSectionText(await section.load());
      text = extracted.text;
      title = extracted.title;
    } catch {
      text = '';
      title = '';
    }
    loaded.push({ label: epubSectionLabel(section, title, tocLabels), text });
  }
  return loaded;
}

function imagePage(titleElement: string, image: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head>${titleElement}</head><body><div><img src="${image}" alt="Scanned page"/></div></body></html>`;
}

/** A two-page scanned book: every section is a single page image. */
function imageOnlyEntries(options: { titles: boolean; toc: boolean }): Record<string, string | Buffer> {
  const title = (label: string): string => (options.titles ? `<title>${label}</title>` : '');
  const navBody = options.toc
    ? '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="page1.xhtml">Page 1</a></li><li><a href="page2.xhtml">Page 2</a></li></ol></nav>'
    : '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol></ol></nav>';
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER_OPF,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="test-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language><dc:identifier id="test-book">urn:uuid:test-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="p1" href="page1.xhtml" media-type="application/xhtml+xml"/><item id="p2" href="page2.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="images/page1.jpg" media-type="image/jpeg"/><item id="img2" href="images/page2.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="p1"/><itemref idref="p2"/></spine></package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Navigation</title></head><body>${navBody}</body></html>`,
    'OEBPS/page1.xhtml': imagePage(title('Page 1'), 'images/page1.jpg'),
    'OEBPS/page2.xhtml': imagePage(title('Page 2'), 'images/page2.jpg'),
    'OEBPS/images/page1.jpg': TINY_JPEG,
    'OEBPS/images/page2.jpg': TINY_JPEG,
  };
}

describe('epubTocLabels, epubSectionLabel, epubSectionText', () => {
  it('flattens nested table-of-contents entries, strips fragments, and keeps the first label per section', () => {
    const labels = epubTocLabels([
      {
        label: 'Chapter One',
        href: 'blob:mock/00000000-0000-4000-8000-000000000001',
        subitems: [
          {
            label: '1.1 Intro',
            href: 'blob:mock/00000000-0000-4000-8000-000000000001#intro',
            subitems: undefined,
          },
        ],
      },
      {
        label: 'Chapter Two',
        href: 'blob:mock/00000000-0000-4000-8000-000000000002#top',
        subitems: undefined,
      },
    ]);
    expect(labels.get('blob:mock/00000000-0000-4000-8000-000000000001')).toBe('Chapter One');
    expect(labels.get('blob:mock/00000000-0000-4000-8000-000000000002')).toBe('Chapter Two');
  });

  it('prefers the table-of-contents title, then the document title, then the file name', () => {
    const section = {
      href: 'blob:mock/00000000-0000-4000-8000-000000000001',
      source: 'Text/chapter1.xhtml',
      index: 0,
    };
    const toc = new Map([['blob:mock/00000000-0000-4000-8000-000000000001', 'Chapter One']]);
    expect(epubSectionLabel(section, 'Chapter One', toc)).toBe('Chapter One');
    expect(epubSectionLabel(section, 'Chapter One', new Map())).toBe('Chapter One');
    expect(epubSectionLabel(section, '', new Map())).toBe('chapter1');
    expect(epubSectionLabel({ href: section.href, index: 4 }, '', new Map())).toBe('Section 5');
  });

  it('never uses the blob UUID as the label', () => {
    const section = {
      href: 'blob:file:///c83aa0f9-11cc-48f8-ad60-b5084ec13b43',
      source: 'page1.xhtml',
      index: 0,
    };
    expect(epubSectionLabel(section, '', new Map())).toBe('page1');
    expect(epubSectionLabel(section, '', new Map())).not.toContain('c83aa0f9');
  });

  it('reads body text only and returns the document title separately', () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>Body text.</p></body></html>`,
      'application/xhtml+xml',
    );
    expect(epubSectionText(doc.documentElement)).toEqual({
      // No whitespace sits between </h1> and <p> in the fixture, so the
      // two text runs concatenate directly — the same as the old
      // whole-document textContent did. What changed is only that the
      // <title> no longer repeats inside the text.
      text: 'Chapter OneBody text.',
      title: 'Chapter One',
    });
  });

  it('reports no text for an image-only body, even when it carries a title', () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page 1</title></head><body><div><img src="page1.jpg" alt="Scanned page one"/></div></body></html>`,
      'application/xhtml+xml',
    );
    expect(epubSectionText(doc.documentElement)).toEqual({ text: '', title: 'Page 1' });
  });

  it('falls back to the whole document when there is no body', () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Loose text</title></head></html>`,
      'application/xhtml+xml',
    );
    expect(epubSectionText(doc.documentElement)).toEqual({ text: 'Loose text', title: 'Loose text' });
  });

  it('reads the text of a minimal { textContent } shape with no querySelector', () => {
    // The shape the reader tests mock section.load() as: a plain object
    // carrying only textContent. The helper must not throw on it and lose
    // the section's text.
    expect(
      epubSectionText({ textContent: '  First chapter text.  ' } as unknown as Element),
    ).toEqual({ text: 'First chapter text.', title: '' });
  });
});

describe('reader section labels and text over real epubjs opens', () => {
  it('shows table-of-contents titles and body text, without repeating the title, for a text book', async () => {
    const book = await openEpubBook(new Uint8Array(zip(epub3Entries())));
    try {
      const sections = await loadReaderSections(book);
      expect(sections).toHaveLength(1);
      // Before the fix the label was the blob UUID
      // (blob:<origin>/00000000-0000-4000-8000-…) and the text repeated
      // the <title> ("Chapter OneChapter OneThe first chapter…").
      expect(sections[0].label).toBe('Chapter One');
      expect(sections[0].text).toBe('Chapter OneThe first chapter body text for testing.');
      expect(sections[0].text).not.toContain('Chapter OneChapter One');
    } finally {
      book.destroy();
    }
  });

  it('shows table-of-contents titles and no extractable text for an image-only book', async () => {
    const book = await openEpubBook(new Uint8Array(zip(imageOnlyEntries({ titles: true, toc: true }))));
    try {
      // The sections genuinely contain no text (a title is metadata, not
      // body text), so the reader reports no extractable text — the
      // heading is the page title, not a blob UUID.
      expect(await loadReaderSections(book)).toEqual([
        { label: 'Page 1', text: '' },
        { label: 'Page 2', text: '' },
      ]);
    } finally {
      book.destroy();
    }
  });

  it('falls back to the file name when a section has neither a table-of-contents entry nor a title', async () => {
    const book = await openEpubBook(new Uint8Array(zip(imageOnlyEntries({ titles: false, toc: false }))));
    try {
      expect(await loadReaderSections(book)).toEqual([
        { label: 'page1', text: '' },
        { label: 'page2', text: '' },
      ]);
    } finally {
      book.destroy();
    }
  });
});

describe('epubInitialSectionIndex', () => {
  // A cover-first book like the Bell Jar: the cover section has no text,
  // the table-of-contents page has a little, the chapters have the book.
  const coverFirst = [
    { href: 'blob:mock/cover', text: '' },
    { href: 'blob:mock/toc', text: 'The Bell JarTable of Contents' },
    { href: 'blob:mock/ch1', text: 'Chapter OneIt was a queer, sultry summer…' },
    { href: 'blob:mock/ch2', text: 'Chapter TwoI wouldn’t have missed it…' },
  ];
  const toc = [
    { label: 'Chapter One', href: 'blob:mock/ch1', subitems: undefined },
    { label: 'Chapter Two', href: 'blob:mock/ch2', subitems: undefined },
  ];

  it('starts at the first table-of-contents entry with text, skipping the textless cover', () => {
    expect(epubInitialSectionIndex(coverFirst, toc)).toBe(2);
  });

  it('starts at section 0 when the first section has text', () => {
    expect(
      epubInitialSectionIndex(
        [
          { href: 'blob:mock/ch1', text: 'Chapter One…' },
          { href: 'blob:mock/ch2', text: 'Chapter Two…' },
        ],
        toc,
      ),
    ).toBe(0);
  });

  it('skips a textless table-of-contents entry (a cover listed first) to the next one with text', () => {
    expect(
      epubInitialSectionIndex(coverFirst, [
        { label: 'Cover', href: 'blob:mock/cover', subitems: undefined },
        ...toc,
      ]),
    ).toBe(2);
  });

  it('falls back to the first section with text when the table of contents is empty', () => {
    expect(epubInitialSectionIndex(coverFirst, [])).toBe(1);
  });

  it('falls back to the first section with text when no table-of-contents entry matches one', () => {
    expect(
      epubInitialSectionIndex(coverFirst, [
        { label: 'Elsewhere', href: 'blob:mock/other', subitems: undefined },
      ]),
    ).toBe(1);
  });

  it('strips fragments when matching table-of-contents hrefs', () => {
    expect(
      epubInitialSectionIndex(coverFirst, [
        { label: 'Chapter One', href: 'blob:mock/ch1#start', subitems: undefined },
      ]),
    ).toBe(2);
  });

  it('considers nested table-of-contents entries in order', () => {
    expect(
      epubInitialSectionIndex(coverFirst, [
        {
          label: 'Front matter',
          href: 'blob:mock/cover',
          subitems: [{ label: 'Chapter One', href: 'blob:mock/ch1', subitems: undefined }],
        },
      ]),
    ).toBe(2);
  });

  it('stays on section 0 when no section has text (a genuinely image-only book)', () => {
    expect(
      epubInitialSectionIndex(
        [
          { href: 'blob:mock/p1', text: '' },
          { href: 'blob:mock/p2', text: '' },
        ],
        [],
      ),
    ).toBe(0);
  });
});

describe('patchFindInSpine', () => {
  function patchedRendition() {
    const spine = [{ href: 'Text/one.xhtml' }, { href: 'Text/two.xhtml' }];
    const rendition = {
      display: async () => undefined,
      attachTo: () => undefined,
      destroy: () => undefined,
      epubcfi: {
        isCfiString: (target: string) => typeof target === 'string' && target.startsWith('epubcfi('),
      },
      spineByHref: { 'Text/one.xhtml': 0, 'Text/two.xhtml': 1 },
      spineBySource: { 'Text/one.xhtml': 0, 'Text/two.xhtml': 1 },
      spineById: { one: 0, two: 1 },
      manifest: { spine },
    };
    const fakeEpub = {
      CFI: class {
        spinePos = 1;
      },
    };
    patchFindInSpine(fakeEpub, rendition as unknown as ReturnType<EpubBook['renderTo']>);
    return { rendition, spine };
  }

  it('finds the first section by href (upstream drops index 0)', () => {
    const { rendition, spine } = patchedRendition();
    const findable = rendition as unknown as { findInSpine: (target: string | number) => unknown };
    expect(findable.findInSpine('Text/one.xhtml')).toBe(spine[0]);
    expect(findable.findInSpine('Text/two.xhtml')).toBe(spine[1]);
  });

  it('strips fragments for the lookup, returns null for unknown hrefs, and handles CFI, index, and id targets', () => {
    const { rendition, spine } = patchedRendition();
    const findable = rendition as unknown as { findInSpine: (target: string | number) => unknown };
    expect(findable.findInSpine('Text/one.xhtml#heading')).toBe(spine[0]);
    expect(findable.findInSpine('Text/missing.xhtml')).toBeNull();
    expect(findable.findInSpine('epubcfi(/6/4!/2/1:0)')).toBe(spine[1]);
    expect(findable.findInSpine(0)).toBe(spine[0]);
    expect(findable.findInSpine('#one')).toBe(spine[0]);
  });
});

describe('mapEpubTocItems', () => {
  it('maps epubjs navigation items to reader table-of-contents items, resolving every level', () => {
    const items = mapEpubTocItems(
      [
        {
          id: 'np1',
          href: 'Text/one.xhtml',
          title: 'First chapter',
          children: [
            { id: 'np2', href: 'Text/two.xhtml#heading', title: 'Second chapter', children: [] },
            {
              id: 'np3',
              href: 'Text/three.xhtml',
              title: 'Third chapter',
              children: [{ id: 'np4', href: 'Text/four.xhtml', title: 'Fourth chapter', children: [] }],
            },
          ],
        },
      ],
      (href) => `resolved:${href}`,
    );
    expect(items).toEqual([
      {
        label: 'First chapter',
        href: 'resolved:Text/one.xhtml',
        subitems: [
          { label: 'Second chapter', href: 'resolved:Text/two.xhtml#heading', subitems: undefined },
          {
            label: 'Third chapter',
            href: 'resolved:Text/three.xhtml',
            subitems: [{ label: 'Fourth chapter', href: 'resolved:Text/four.xhtml', subitems: undefined }],
          },
        ],
      },
    ]);
  });

  it('maps an empty table of contents to an empty list', () => {
    expect(mapEpubTocItems([], (href) => href)).toEqual([]);
  });
});
