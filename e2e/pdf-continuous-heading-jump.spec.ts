// Continuous-view page heading after a jump: the reader's "Page N of M"
// heading must follow the page the jump landed on, not the page the
// visual stack reports. Regression for the 1.9.23 fix batch's leftover:
// in Continuous view the heading followed the scroll tracker, which
// read only the visual page stack while the accessible text sits below
// that whole stack — so after an annotation or bookmark jump scrolled
// the landed text into view, the tracker saw the last visual page on
// top and the heading read the old page (e.g. "Page 3 of 3" after
// landing on page 2). The same spec also proves the tracker still
// follows manual scrolling, visual and semantic, so the fix is in the
// tracker itself and not a heading patch in the jump handler.
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  pressShortcut,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

async function threePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [
    ['Alpha line one.', 'Alpha line two.'],
    ['Beta line one.', 'Beta line two.'],
    ['Gamma line one.', 'Gamma line two.'],
  ];
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    let y = 720;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 20;
    }
  }
  return doc.save();
}

async function launchSeededApp(paths: SeedPaths): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  return { app, page };
}

async function openPdf(page: Page): Promise<void> {
  await openNotebook(page, 'Notes');
  await openGridEntry(page, 'Guide.pdf');
  await expect(page.getByRole('heading', { name: 'Page text' })).toBeVisible({ timeout: 30000 });
}

/** Place a collapsed selection in the reader's accessible page text, the way a screen reader's virtual cursor leaves it. */
async function placePdfSelection(page: Page, text: string, offset = 1): Promise<void> {
  await page.waitForFunction(
    ({ wanted }) => {
      const section = document.querySelector('section[aria-label^="Accessible text for PDF page"]');
      if (!section) return false;
      return [...section.querySelectorAll('[data-start-offset]')].some((span) =>
        span.textContent?.includes(wanted),
      );
    },
    { wanted: text },
    { timeout: 30000 },
  );
  await page.evaluate(
    ({ wanted, at }) => {
      const section = document.querySelector('section[aria-label^="Accessible text for PDF page"]');
      if (!section) throw new Error('PDF page text section not found');
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.data.includes(wanted)) {
          const range = document.createRange();
          range.setStart(node, Math.min(at, node.data.length));
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
      }
      throw new Error(`PDF text not found: ${wanted}`);
    },
    { wanted: text, at: offset },
  );
}

/** Place a collapsed selection in continuous view, where every page has its own accessible-text section. */
async function placeContinuousSelection(page: Page, text: string, offset = 1): Promise<void> {
  await page.waitForFunction(
    ({ wanted }) => {
      const sections = [...document.querySelectorAll('section[aria-label^="Accessible text for PDF page"]')];
      return sections.some((section) =>
        [...section.querySelectorAll('[data-start-offset]')].some((span) => span.textContent?.includes(wanted)),
      );
    },
    { wanted: text },
    { timeout: 30000 },
  );
  await page.evaluate(
    ({ wanted, at }) => {
      const sections = [...document.querySelectorAll('section[aria-label^="Accessible text for PDF page"]')];
      for (const section of sections) {
        const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.data.includes(wanted)) {
            const range = document.createRange();
            range.setStart(node, Math.min(at, node.data.length));
            range.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            return;
          }
        }
      }
      throw new Error(`PDF text not found: ${wanted}`);
    },
    { wanted: text, at: offset },
  );
}

/** Set a bookmark with a shortcut and save it under the given name (or its default). */
async function bookmarkWithShortcut(page: Page, name: string): Promise<void> {
  await pressShortcut(page, 'Control+Alt+B');
  const dialog = page.getByRole('dialog', { name: 'Name bookmark' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Bookmark name').fill(name);
  await dialog.getByRole('button', { name: 'Save bookmark' }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
}

async function readingJumpState(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName ?? '',
      text: active?.textContent ?? '',
      selection: window.getSelection()?.toString() ?? '',
    };
  });
}

/** Bookmark the Beta (page 2) and Gamma (page 3) spots, then switch to Continuous view. */
async function seedBookmarksAndSwitchToContinuous(page: Page): Promise<void> {
  await openPdf(page);
  await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('radio', { name: 'Paginated view' }).click();
  await expect(page.getByRole('radio', { name: 'Paginated view' })).toBeChecked();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible({ timeout: 30000 });
  await placePdfSelection(page, 'Beta line two.');
  await bookmarkWithShortcut(page, 'Beta second');
  await expect(statusLine(page)).toContainText('Bookmarked "Beta second" on page 2.', { timeout: 30000 });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 3 of 3' })).toBeVisible({ timeout: 30000 });
  await placePdfSelection(page, 'Gamma line one.');
  await bookmarkWithShortcut(page, 'Gamma spot');
  await expect(statusLine(page)).toContainText('Bookmarked "Gamma spot" on page 3.', { timeout: 30000 });
  await page.getByRole('radio', { name: 'Continuous view' }).click();
  await expect(page.getByRole('radio', { name: 'Continuous view' })).toBeChecked();
}

test('continuous: a bookmark list jump moves the page heading to the landed page', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Notes', files: [{ name: 'Guide.pdf', content: await threePagePdf() }] }]);
  const { app, page } = await launchSeededApp(paths);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await seedBookmarksAndSwitchToContinuous(page);
    // Move away: read on page 3, then jump back to the page 2 bookmark
    // from the list. The landing (focus + selection) proves the jump;
    // the heading must read the landed page, not the page the visual
    // stack reports after the text scrolls into view.
    await placeContinuousSelection(page, 'Gamma line two.');
    await page.getByRole('button', { name: 'Beta second (Page 2)' }).click();
    await expect
      .poll(() => readingJumpState(page), { timeout: 15000 })
      .toMatchObject({ tag: 'P', text: expect.stringContaining('Beta line two.') });
    await expect(statusLine(page)).toContainText('Jumped to Beta second.', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('continuous: Ctrl+Alt+J jumps move the page heading to the landed page', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Notes', files: [{ name: 'Guide.pdf', content: await threePagePdf() }] }]);
  const { app, page } = await launchSeededApp(paths);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await seedBookmarksAndSwitchToContinuous(page);
    // Past the last bookmark on page 3: J wraps to the first, on page 2.
    await placeContinuousSelection(page, 'Gamma line two.');
    await pressShortcut(page, 'Control+Alt+J');
    await expect
      .poll(() => readingJumpState(page), { timeout: 15000 })
      .toMatchObject({ tag: 'P', text: expect.stringContaining('Beta line two.') });
    await expect(statusLine(page)).toContainText('Jumped to Beta second.', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible({ timeout: 10000 });
    // From there J jumps forward to the Gamma bookmark on page 3.
    await pressShortcut(page, 'Control+Alt+J');
    await expect
      .poll(() => readingJumpState(page), { timeout: 15000 })
      .toMatchObject({ tag: 'P', text: expect.stringContaining('Gamma line one.') });
    await expect(statusLine(page)).toContainText('Jumped to Gamma spot.', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Page 3 of 3' })).toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('continuous: manual scrolling still moves the page heading, visual and semantic', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Notes', files: [{ name: 'Guide.pdf', content: await threePagePdf() }] }]);
  const { app, page } = await launchSeededApp(paths);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await openPdf(page);
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
    // Scrolling the visual stack moves the heading, as before.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-pdf-page="3"]')?.scrollIntoView();
    });
    await expect(page.getByRole('heading', { name: 'Page 3 of 3' })).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-pdf-page="1"]')?.scrollIntoView();
    });
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 10000 });
    // Scrolling the accessible text itself moves the heading too: the
    // text sits below the whole visual stack, so a tracker that only
    // reads the visual pages would still report the last visual page.
    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>('section[aria-label^="Accessible text for PDF"] [data-pdf-page="2"]')
        ?.scrollIntoView();
    });
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
