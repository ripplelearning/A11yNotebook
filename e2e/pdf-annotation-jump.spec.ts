// Activating a PDF annotation must move the screen reader's focus
// and virtual cursor to the exact spot in the PDF text where the
// annotation was inserted — not just navigate the reader. Regression
// for Tristen's 1.9.23 retest: activating an annotation from the
// Saved PDF Notes list did nothing observable; focus and selection
// stayed where they were. The spec also covers her new "Annotations"
// heading: the annotations list sits beneath a real "Annotations"
// heading.
import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
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

/** Two-page PDF; page 1 carries the annotated sentence. */
async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([612, 792]);
  first.drawText('The quick brown fox jumps over the lazy dog.', { x: 50, y: 720, size: 12, font });
  first.drawText('Pack my box with five dozen liquor jugs.', { x: 50, y: 700, size: 12, font });
  const second = doc.addPage([612, 792]);
  second.drawText('A completely different second page with no shared sentences.', {
    x: 50,
    y: 720,
    size: 12,
    font,
  });
  return doc.save();
}

async function openPdf(paths: SeedPaths): Promise<{ app: Awaited<ReturnType<typeof launchApp>>['app']; page: Page }> {
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await openNotebook(page, 'Notes');
  await openGridEntry(page, 'TwoPages.pdf');
  await expect(page.getByRole('heading', { name: 'Page text' })).toBeVisible({ timeout: 30000 });
  return { app, page };
}

/**
 * Select the phrase in the accessible page text the way a reader
 * does, then focus its block so the Ctrl+Alt+A shortcut runs with
 * the reader as its context. Returns false when the phrase cannot
 * be found in the rendered text.
 */
async function selectPhrase(page: Page, phrase: string, pageNum?: number): Promise<boolean> {
  return page.getByRole('region', { name: 'PDF document reader' }).evaluate(
    (reader, { phrase: wanted, pageNum: wantedPage }) => {
      const scope =
        wantedPage === undefined
          ? reader
          : (reader.querySelector(`[data-pdf-page="${wantedPage}"]`) ?? reader);
      const span = [...scope.querySelectorAll('[data-start-offset]')].find((candidate) =>
        (candidate.textContent ?? '').includes(wanted),
      );
      if (!span) return false;
      const textNode = span.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(wanted);
      if (start < 0) return false;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + wanted.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const block = span.closest('[tabindex]');
      if (block instanceof HTMLElement) block.focus();
      return true;
    },
    { phrase, pageNum },
  );
}

/** Live focus/selection state in the reader: what a screen reader's virtual cursor follows. */
async function pdfLanding(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const active = document.activeElement as HTMLElement | null;
    return {
      text: selection?.toString() ?? '',
      collapsed: selection?.isCollapsed ?? true,
      anchorNodeType: selection?.anchorNode?.nodeType ?? -1,
      activeTag: active?.tagName ?? '',
      activeText: active?.textContent ?? '',
    };
  });
}

/** Create the annotation exactly as Tristen did: select text, Ctrl+Alt+A, label, save. */
async function createAnnotation(page: Page, phrase: string, label: string): Promise<void> {
  // The accessible text renders asynchronously after the page opens;
  // keep trying the selection until the spans are there.
  await expect.poll(() => selectPhrase(page, phrase), { timeout: 60000 }).toBe(true);
  await page.keyboard.press('Control+Alt+a');
  const dialog = page.getByRole('dialog', { name: 'Create PDF note' });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByRole('textbox', { name: 'Label (optional)' }).fill(label);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `${label} — yellow, page 1` })).toBeVisible();
}

async function expectLandedOnPhrase(
  page: Page,
  phrase: string,
  label: string,
  checkPageHeading = true,
): Promise<void> {
  // Focus AND a live, non-collapsed, text-node selection land on the
  // annotated words — the landing a screen reader's virtual cursor
  // follows. This is asserted separately from the status line so a
  // failure names the part that did not move.
  await expect
    .poll(() => pdfLanding(page), { timeout: 30000 })
    .toMatchObject({ text: phrase, collapsed: false, anchorNodeType: 3, activeTag: 'P' });
  const landing = await pdfLanding(page);
  expect(landing.activeText).toContain(phrase);
  if (checkPageHeading) await expect(page.getByRole('heading', { name: 'Page 1 of 2' })).toBeVisible();
  await expect(page.getByText(`Jumped to annotation: ${label}.`)).toBeVisible({ timeout: 10000 });
  // The annotation lists beneath the Annotations heading.
  await expect(page.getByRole('heading', { name: 'Annotations' })).toBeVisible();
}

test('paginated: activating an annotation on another page lands focus and selection on the annotated text', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([
    { name: 'Notes', files: [{ name: 'TwoPages.pdf', content: await twoPagePdf() }] },
  ]);
  const { app, page } = await openPdf(paths);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    const reader = page.getByRole('region', { name: 'PDF document reader' });
    // Paginated is the view under test here (not the default): the
    // Next page button only exists in Paginated view.
    await reader.getByRole('radio', { name: 'Paginated view' }).click();
    await createAnnotation(page, 'quick brown fox', 'Fox note');
    // Move away: turn to page 2, then activate the annotation from the list.
    await reader.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('heading', { name: 'Page 2 of 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Fox note — yellow, page 1' }).click();
    await expectLandedOnPhrase(page, 'quick brown fox', 'Fox note');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('continuous: activating an annotation on another page lands focus and selection on the annotated text', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([
    { name: 'Notes', files: [{ name: 'TwoPages.pdf', content: await twoPagePdf() }] },
  ]);
  const { app, page } = await openPdf(paths);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    const reader = page.getByRole('region', { name: 'PDF document reader' });
    await reader.getByRole('radio', { name: 'Continuous view' }).click();
    await createAnnotation(page, 'quick brown fox', 'Fox note');
    // Move away: focus a block on page 2, then activate the annotation from the list.
    const moved = await reader.evaluate((root) => {
      const block = root.querySelector('[data-pdf-page="2"] [tabindex]') as HTMLElement | null;
      if (!block) return false;
      block.focus();
      return document.activeElement === block;
    });
    expect(moved).toBe(true);
    await page.getByRole('button', { name: 'Fox note — yellow, page 1' }).click();
    // The heading follows the landed page: the scroll tracker reads
    // the visual and the accessible-text page stacks, so the landing
    // scroll into the page-1 text does not leave it on page 2.
    await expectLandedOnPhrase(page, 'quick brown fox', 'Fox note');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('same page: activating an annotation after moving focus away lands on the spot', async () => {
  test.setTimeout(180000);
  const paths = seedLibrary([
    { name: 'Notes', files: [{ name: 'TwoPages.pdf', content: await twoPagePdf() }] },
  ]);
  const { app, page } = await openPdf(paths);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    // Paginated is the view under test here: the continuous-view
    // heading check lives in the continuous test above.
    await page
      .getByRole('region', { name: 'PDF document reader' })
      .getByRole('radio', { name: 'Paginated view' })
      .click();
    await createAnnotation(page, 'quick brown fox', 'Fox note');
    // Move focus away from the text, then activate the annotation from the list.
    await page.getByRole('button', { name: 'Copy notes to clipboard' }).focus();
    await expect(page.getByRole('button', { name: 'Copy notes to clipboard' })).toBeFocused();
    await page.getByRole('button', { name: 'Fox note — yellow, page 1' }).click();
    await expectLandedOnPhrase(page, 'quick brown fox', 'Fox note');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
