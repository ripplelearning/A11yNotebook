// Continuous-view heading specs must drive the app through launchApp's
// window, not the Playwright `page` fixture (which launches a bare
// browser that CI may not have).
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { closeApp, dismissTutorial, launchApp, openGridEntry, openNotebook, seedLibrary, waitForApp } from './helpers';

/**
 * PDF continuous-view headings end-to-end pass: in Continuous view every
 * page starts with a real heading, so JAWS heading navigation (H) moves
 * through each page of the document in order. The semantic text itself
 * carries no headings unless the PDF is tagged, so without a per-page
 * heading the whole document has only the reader's "Page text" heading
 * and there is nothing per page to navigate to.
 *
 * The fixture is generated with pdf-lib, so no third-party file is
 * involved: one distinct line of text per page, no tagged headings.
 */
async function threePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = ['Headings first page text', 'Headings second page text', 'Headings third page text'];
  for (const line of lines) {
    const page = doc.addPage([612, 792]);
    page.drawText(line, { x: 50, y: 700, size: 14, font });
  }
  return doc.save();
}

async function openThreePagePdf(page: Page): Promise<void> {
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Docs' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await openNotebook(page, 'Docs');
  await openGridEntry(page, 'Guide.pdf');
  await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
}

test('PDF continuous view exposes one heading per page, in order, in the accessibility tree', async () => {
  test.setTimeout(180000);
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([{ name: 'Docs', files: [{ name: 'Guide.pdf', content: await threePagePdf() }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openThreePagePdf(page);
    const navigation = page.getByRole('group', { name: 'PDF page navigation' });
    const textSection = page.locator('section[aria-label^="Accessible text for PDF"]');

    // Paginated view shows one page at a time: no per-page headings.
    await navigation.getByRole('radio', { name: 'Paginated view' }).click();
    await expect(navigation.getByRole('radio', { name: 'Paginated view' })).toBeChecked();
    await expect(textSection.getByRole('heading', { name: 'Page 2', exact: true })).toHaveCount(0);
    await expect(textSection.getByRole('heading', { name: 'Page 3', exact: true })).toHaveCount(0);

    await navigation.getByRole('radio', { name: 'Continuous view' }).click();
    await expect(textSection.getByText('Headings second page text')).toBeVisible();
    await expect(textSection.getByText('Headings third page text')).toBeVisible();

    // One real heading per page, in document order, inside the
    // accessible-text section — this is what JAWS heading navigation
    // steps through.
    await expect(textSection.getByRole('heading')).toHaveText(['Page text', 'Page 1', 'Page 2', 'Page 3']);
    for (const pageNumber of [1, 2, 3]) {
      const heading = textSection.getByRole('heading', { name: `Page ${pageNumber}`, exact: true });
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCount(1);
      // Each page heading sits at the top of its own page wrapper,
      // before that page's text.
      const wrapper = page.locator(`section[aria-label^="Accessible text for PDF"] [data-pdf-page="${pageNumber}"]`);
      await expect(wrapper.getByRole('heading', { name: `Page ${pageNumber}`, exact: true })).toHaveCount(1);
      await expect(
        wrapper.getByText(`Headings ${['first', 'second', 'third'][pageNumber - 1]} page text`),
      ).toBeVisible();
    }

    // The per-page headings are markers, not tab stops.
    // (getByRole queries the accessibility tree itself, so the heading
    // assertions above already prove these headings are in the tree a
    // screen reader walks, in document order. page.accessibility is not
    // available on the Electron window, so there is no separate snapshot
    // call to make here.)
    const headingTags = await textSection
      .locator('h5')
      .evaluateAll((elements) => elements.map((element) => element.textContent));
    expect(headingTags).toEqual(['Page 1', 'Page 2', 'Page 3']);

    // Switching back to Paginated view removes the per-page headings
    // with the other pages.
    await navigation.getByRole('radio', { name: 'Paginated view' }).click();
    await expect(textSection.getByRole('heading', { name: 'Page 2', exact: true })).toHaveCount(0);
    await expect(textSection.getByRole('heading', { name: 'Page 3', exact: true })).toHaveCount(0);
    await expect(textSection.getByText('Headings first page text')).toBeVisible();
    await expect(textSection.getByText('Headings second page text')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
