// Continuous-view specs must drive the app through launchApp's window, not the
// Playwright `page` fixture (which launches a bare browser that CI may not have).
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { rmSync } from 'node:fs';
import { closeApp, dismissTutorial, launchApp, openGridEntry, openNotebook, seedLibrary, waitForApp } from './helpers';

/**
 * PDF continuous view end-to-end pass: a three-page PDF opens in
 * Continuous view by default, the view choice in the Page Navigation
 * section is a radio group with exactly one view checked, Continuous
 * view shows the whole document as one continuous page and hides
 * Previous/Next, scrolling moves the current page, switching to
 * Paginated view restores paginated navigation on the current page, and
 * switching back returns to Continuous view.
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

test('PDF opens in Continuous view by default, radio group switches views, hides Previous/Next in continuous view, tracks the current page', async () => {
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
    const paginated = navigation.getByRole('radio', { name: 'Paginated view' });
    const continuous = navigation.getByRole('radio', { name: 'Continuous view' });
    await expect(continuous).toBeVisible();
    // Exactly one view reads as active: Continuous checked, Paginated unchecked.
    await expect(continuous).toBeChecked();
    await expect(paginated).not.toBeChecked();
    // Continuous: the whole document is shown as one page, with no
    // Previous/Next buttons.
    const pageText = page.locator('section[aria-label^="Accessible text for PDF"]');
    await expect(pageText.getByText('Continuous first page text')).toBeVisible();
    await expect(pageText.getByText('Continuous second page text')).toBeVisible();
    await expect(pageText.getByText('Continuous third page text')).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Previous page' })).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: 'Next page' })).toHaveCount(0);

    // Scrolling to the last page moves the current page with it.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-pdf-page="3"]')?.scrollIntoView();
    });
    await expect(page.getByRole('heading', { name: 'Page 3 of 3' })).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-pdf-page="1"]')?.scrollIntoView();
    });
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 10000 });

    // Switching to Paginated view restores Previous/Next and shows one page.
    await paginated.click();
    await expect(paginated).toBeChecked();
    await expect(continuous).not.toBeChecked();
    await expect(navigation.getByRole('button', { name: 'Previous page' })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Next page' })).toBeVisible();
    await expect(pageText.getByText('Continuous first page text')).toBeVisible();
    await expect(pageText.getByText('Continuous second page text')).toHaveCount(0);
    await expect(pageText.getByText('Continuous third page text')).toHaveCount(0);

    // Paginated navigation still works: Previous/Next move the current page.
    await navigation.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible();
    await navigation.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible();

    // Switching back with the keyboard returns to Continuous view: focus
    // the Paginated radio and arrow right to the Continuous radio.
    await paginated.focus();
    await page.keyboard.press('ArrowRight');
    await expect(continuous).toBeChecked();
    await expect(paginated).not.toBeChecked();
    await expect(navigation.getByRole('button', { name: 'Previous page' })).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible();
    await expect(pageText.getByText('Continuous second page text')).toBeVisible();
    await expect(pageText.getByText('Continuous third page text')).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

/**
 * Reopen the PDF after a relaunch. The app restores into the Docs
 * notebook (with the attachment tab closed), so the library root's
 * Docs cell is gone: when already inside Docs, open the file from its
 * grid instead of navigating from the library root. If the Guide.pdf
 * tab was restored, switch to it instead.
 */
async function reopenThreePagePdf(page: Page): Promise<void> {
  await waitForApp(page);
  await dismissTutorial(page);
  const tab = page.getByRole('tab', { name: 'Guide.pdf' });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else if (
    await page
      .getByRole('region', { name: 'Notes and Files in Docs' })
      .isVisible()
      .catch(() => false)
  ) {
    await openGridEntry(page, 'Guide.pdf');
  } else {
    await openNotebook(page, 'Docs');
    await openGridEntry(page, 'Guide.pdf');
  }
  await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
}

test('PDF view choice is remembered for the next PDF and across a relaunch', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Docs', files: [{ name: 'Guide.pdf', content: await threePagePdf() }] }]);
  let app: ElectronApplication | null = null;
  try {
    let launched = await launchApp(paths.userDataDir);
    app = launched.app;
    let page = launched.page;
    await openThreePagePdf(page);
    const navigation = () => page.getByRole('group', { name: 'PDF page navigation' });

    // The default is Continuous; switching to Paginated is remembered.
    await expect(navigation().getByRole('radio', { name: 'Continuous view' })).toBeChecked();
    await navigation().getByRole('radio', { name: 'Paginated view' }).click();
    await expect(navigation().getByRole('radio', { name: 'Paginated view' })).toBeChecked();

    // The choice survives a relaunch: the reopened PDF starts paginated.
    await app.close();
    launched = await launchApp(paths.userDataDir);
    app = launched.app;
    page = launched.page;
    await reopenThreePagePdf(page);
    await expect(navigation().getByRole('radio', { name: 'Paginated view' })).toBeChecked();
    await expect(navigation().getByRole('radio', { name: 'Continuous view' })).not.toBeChecked();
    await expect(navigation().getByRole('button', { name: 'Next page' })).toBeVisible();

    // Switching back to Continuous is remembered the same way.
    await navigation().getByRole('radio', { name: 'Continuous view' }).click();
    await expect(navigation().getByRole('radio', { name: 'Continuous view' })).toBeChecked();
    await app.close();
    launched = await launchApp(paths.userDataDir);
    app = launched.app;
    page = launched.page;
    await reopenThreePagePdf(page);
    await expect(navigation().getByRole('radio', { name: 'Continuous view' })).toBeChecked();
    await expect(navigation().getByRole('radio', { name: 'Paginated view' })).not.toBeChecked();
    await expect(navigation().getByRole('button', { name: 'Next page' })).toHaveCount(0);
  } finally {
    await app?.close();
    rmSync(paths.baseDir, { recursive: true, force: true });
  }
});
