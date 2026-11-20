// A book whose first spine item is its cover — an image with no text —
// must open on the first readable chapter, not present "No extractable
// text was found in this section." for a book full of text. Regression
// for Tristen's November 19, 2026 report: the Bell Jar and a Project
// Gutenberg book both opened on their covers, which genuinely have no
// text, while every chapter extracts fine.
import { test, expect } from '@playwright/test';
import { zip } from '../src/test/test-zip';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  seedLibrary,
  waitForApp,
  type SeedPaths,
} from './helpers';

// Tiny 1x1 JPEG (baseline, valid) — the cover image.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==',
  'base64',
);

/** EPUB 3 whose spine starts with an image-only cover, then two text chapters. */
function coverFirstEpubEntries(): Record<string, string | Buffer> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="cover-first-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Cover First Book</dc:title><dc:language>en</dc:language><dc:identifier id="cover-first-book">urn:uuid:cover-first-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.jpg" media-type="image/jpeg"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover"/><itemref idref="chapter1"/><itemref idref="chapter2"/></spine></package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter One</a></li><li><a href="chapter2.xhtml">Chapter Two</a></li></ol></nav></body></html>`,
    'OEBPS/cover.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><div><img src="cover.jpg" alt="Cover art"/></div></body></html>`,
    'OEBPS/cover.jpg': TINY_JPEG,
    'OEBPS/chapter1.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>This is the first chapter of the cover-first book.</p></body></html>`,
    'OEBPS/chapter2.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><h1>Chapter Two</h1><p>This is the second chapter of the cover-first book.</p></body></html>`,
  };
}

test('epub opens on the first readable chapter, not the textless cover', async () => {
  const paths: SeedPaths = seedLibrary([
    { name: 'Books', files: [{ name: 'CoverFirst.epub', content: zip(coverFirstEpubEntries()) }] },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNotebook(page, 'Books');
    await openGridEntry(page, 'CoverFirst.epub');
    const reader = page.getByRole('region', { name: 'ePub document reader' });
    await expect(reader).toBeVisible({ timeout: 30000 });
    // The book opens on Chapter One — the first table-of-contents entry
    // with text — not on the cover, which has no extractable text.
    await expect(reader.locator('h3')).toContainText('Section 2 of 3', { timeout: 30000 });
    await expect(
      reader.locator('article', { hasText: 'This is the first chapter of the cover-first book.' }),
    ).toBeVisible({ timeout: 30000 });
    await expect(reader.getByRole('heading', { name: 'Chapter One' })).toBeVisible({ timeout: 30000 });
    // The cover is still reachable, and still honestly reports no text.
    await reader.getByRole('button', { name: 'Previous section' }).click();
    await expect(reader.locator('h3')).toContainText('Section 1 of 3', { timeout: 30000 });
    await expect(reader.locator('article p')).toContainText('No extractable text was found in this section.', {
      timeout: 30000,
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
