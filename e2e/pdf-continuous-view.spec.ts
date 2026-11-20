// Continuous-view specs must drive the app through launchApp's window, not the
// Playwright `page` fixture (which launches a bare browser that CI may not have).
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  seedLibrary,
  waitForApp,
} from './helpers';

/**
 * PDF continuous view end-to-end pass: a three-page PDF opens paginated,
 * the toggle in the Page Navigation section (before Previous/Next) shows
 * the whole document as one continuous page with the pressed state
 * exposed, Previous/Next and scrolling move the current page, and
 * toggling back restores paginated navigation on the current page.
 *
 * The fixture is generated with pdf-lib, so no third-party file is
 * involved: one distinct line of text per page.
 */
async function threePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = ['Continuous first page text', 'Continuous second page text', 'Continuous third page text'];
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

test('PDF continuous view toggle switches between paginated and continuous view, tracking the current page', async () => {
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
    const toggle = navigation.getByRole('button', { name: 'Paginated view' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // The toggle sits before the Previous/Next page buttons.
    const buttons = navigation.getByRole('button');
    await expect(buttons.nth(0)).toHaveText('Paginated view');
    await expect(buttons.nth(1)).toHaveText('Previous page');
    await expect(buttons.nth(2)).toHaveText('Next page');
    // Paginated: only the first page's text is shown.
    const pageText = page.locator('section[aria-label^="Accessible text for PDF"]');
    await expect(pageText.getByText('Continuous first page text')).toBeVisible();
    await expect(pageText.getByText('Continuous second page text')).toHaveCount(0);

    await toggle.click();
    const continuousToggle = navigation.getByRole('button', { name: 'Continuous view' });
    await expect(continuousToggle).toHaveAttribute('aria-pressed', 'true');
    // Continuous: the whole document is shown as one page.
    await expect(pageText.getByText('Continuous first page text')).toBeVisible();
    await expect(pageText.getByText('Continuous second page text')).toBeVisible();
    await expect(pageText.getByText('Continuous third page text')).toBeVisible();

    // Previous/Next move the current page in continuous view.
    await navigation.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible();
    await navigation.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('heading', { name: 'Page 3 of 3' })).toBeVisible();

    // Scrolling back to the first page moves the current page with it.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-pdf-page="1"]')?.scrollIntoView();
    });
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 10000 });

    // Toggling back restores paginated navigation, on the current page,
    // with the keyboard: focus the toggle and press Enter.
    await navigation.getByRole('button', { name: 'Continuous view' }).focus();
    await page.keyboard.press('Enter');
    await expect(navigation.getByRole('button', { name: 'Paginated view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible();
    await expect(pageText.getByText('Continuous first page text')).toBeVisible();
    await expect(pageText.getByText('Continuous second page text')).toHaveCount(0);
    await expect(pageText.getByText('Continuous third page text')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
