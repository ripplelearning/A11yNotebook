// Activating "Jump to text" on an ePub annotation must move the screen
// reader's focus and virtual cursor to the exact spot in the book where
// the annotation was inserted — not just navigate the rendition view.
// Regression for Tristen's 1.9.22 retest: the buttons did nothing
// observable; display() moved the view but left focus and selection
// where they were.
import { test, expect, type Page } from '@playwright/test';
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

/** EPUB 3 with two text chapters; Chapter One carries the annotated sentence. */
function annotatedEpubEntries(): Record<string, string | Buffer> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="annotated-book" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Annotated Book</dc:title><dc:language>en</dc:language><dc:identifier id="annotated-book">urn:uuid:annotated-book</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter1"/><itemref idref="chapter2"/></spine></package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter One</a></li><li><a href="chapter2.xhtml">Chapter Two</a></li></ol></nav></body></html>`,
    'OEBPS/chapter1.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>This is the first chapter of the book, with an annotated sentence in the middle of it.</p><p>A second paragraph follows the annotated one.</p></body></html>`,
    'OEBPS/chapter2.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><h1>Chapter Two</h1><p>This is the second chapter of the book.</p></body></html>`,
  };
}

/** The live focus/selection state inside the rendition iframe. Note the
 * tagName case: the section is XHTML, so tagName keeps the source case
 * ('p'), unlike an HTML document's uppercase 'P'. */
async function iframeLanding(page: Page) {
  return page
    .frameLocator('.epub-rendition iframe')
    .locator('body')
    .evaluate((body) => {
      const doc = body.ownerDocument;
      const selection = doc.getSelection();
      const active = doc.activeElement as HTMLElement | null;
      return {
        text: selection?.toString() ?? '',
        collapsed: selection?.isCollapsed ?? true,
        activeTag: active?.tagName ?? '',
        activeText: active?.textContent ?? '',
      };
    });
}

/**
 * Select the words "annotated sentence" in the rendered chapter and save
 * an annotation for them, the way a reader does: the selection arms the
 * Annotate button through the rendition's selectionchange listener.
 */
async function createAnnotation(page: Page, label: string) {
  const reader = page.getByRole('region', { name: 'ePub document reader' });
  const frame = page.frameLocator('.epub-rendition iframe');
  await frame.locator('p', { hasText: 'annotated sentence' }).waitFor({ timeout: 30000 });
  await frame.locator('body').evaluate(() => {
    const paragraph = [...document.querySelectorAll('p')].find((p) =>
      (p.textContent ?? '').includes('annotated sentence'),
    );
    const textNode = paragraph?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
    const text = textNode.textContent ?? '';
    const start = text.indexOf('annotated sentence');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'annotated sentence'.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  });
  await reader.getByRole('button', { name: 'Annotate selection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add ePub annotation' });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByLabel('Highlight label').fill(label);
  await dialog.getByRole('button', { name: 'Save annotation' }).click();
  await expect(reader.getByRole('button', { name: `Jump to annotation: ${label}` })).toBeVisible({
    timeout: 10000,
  });
}

async function openAnnotatedBook(): Promise<{ app: Awaited<ReturnType<typeof launchApp>>['app']; page: Page; paths: SeedPaths }> {
  const paths: SeedPaths = seedLibrary([
    { name: 'Books', files: [{ name: 'Annotated.epub', content: zip(annotatedEpubEntries()) }] },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await openNotebook(page, 'Books');
  await openGridEntry(page, 'Annotated.epub');
  const reader = page.getByRole('region', { name: 'ePub document reader' });
  await expect(reader).toBeVisible({ timeout: 30000 });
  await expect(reader.locator('h3')).toContainText('Section 1 of 2', { timeout: 30000 });
  await expect(
    reader.locator('article', { hasText: 'This is the first chapter of the book' }),
  ).toBeVisible({ timeout: 30000 });
  return { app, page, paths };
}

test('jump to an annotation in another section navigates there and lands focus and selection on the spot', async () => {
  const { app, page, paths } = await openAnnotatedBook();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    const reader = page.getByRole('region', { name: 'ePub document reader' });
    await createAnnotation(page, 'Key sentence');
    // Leave the annotated section, then jump back to the annotation.
    await reader.getByRole('button', { name: 'Next section' }).click();
    await expect(reader.locator('h3')).toContainText('Section 2 of 2', { timeout: 30000 });
    await reader.getByRole('button', { name: 'Jump to annotation: Key sentence' }).click();
    // The reader is back on Chapter One, and the landing — not just the
    // view — is on the annotated words: the iframe's selection holds
    // them and its focused element is the paragraph holding them.
    await expect(reader.locator('h3')).toContainText('Section 1 of 2', { timeout: 30000 });
    await expect
      .poll(() => iframeLanding(page), { timeout: 30000 })
      .toMatchObject({ text: 'annotated sentence', collapsed: false, activeTag: 'p' });
    const landing = await iframeLanding(page);
    expect(landing.activeText).toContain('annotated sentence');
    await expect(reader.getByText('Jumped to annotation: Key sentence.')).toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('jump to an annotation in the current section lands focus and selection on the spot', async () => {
  const { app, page, paths } = await openAnnotatedBook();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    const reader = page.getByRole('region', { name: 'ePub document reader' });
    await createAnnotation(page, 'Same section');
    await reader.getByRole('button', { name: 'Jump to annotation: Same section' }).click();
    await expect
      .poll(() => iframeLanding(page), { timeout: 30000 })
      .toMatchObject({ text: 'annotated sentence', collapsed: false, activeTag: 'p' });
    const landing = await iframeLanding(page);
    expect(landing.activeText).toContain('annotated sentence');
    await expect(reader.getByText('Jumped to annotation: Same section.')).toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
