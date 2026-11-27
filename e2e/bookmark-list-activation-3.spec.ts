import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  pressShortcut,
  runPaletteCommand,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Bookmarks LIST activation, third round (1.9.25 retest item 5):
 * activating a bookmark from the Bookmarks list still did not move
 * screen-reader focus to the bookmark, even after PR #260 hid the
 * list's bullet markers. The cause was not the markers: the list
 * button routed through openEntry, which re-requests focus in the
 * main region — and for a note whose origin record is gone (a cloud
 * sync replacing the file drops it, so the note reads as unmanaged)
 * that request is issued only after an awaited encryption check, in
 * a later commit than the jump. It lands after the bookmark landing
 * and yanks focus back to the top of the note: the jump announces,
 * the selection sits on the bookmarked text, but focus rests on the
 * tab panel. The fix lands directly in the activation when the note
 * is already the current tab, the Find way — select and focus
 * synchronously, with no openEntry call to race it.
 *
 * The unmanaged-note test below fails on the unmodified base (focus
 * ends on the tab panel with the selection still on the bookmarked
 * heading) and passes with the fix. The other tests guard the
 * activation variants that already worked: focus-less clicks
 * (screen-reader browse-mode activation), a closed note, focus
 * sitting on a document heading, activation right after reopening,
 * and chaining two activations. A file-level bookmark (the note
 * toggle, no anchor) has no spot of its own: activating it jumps to
 * where reading stopped in that note and announces it.
 */

const FILLER = Array.from(
  { length: 14 },
  (_, i) => `Filler paragraph ${i + 1} to make the note long enough to scroll.\n`,
).join('\n');

const NOTE_CONTENT =
  '# Field Notes\n' +
  '\n' +
  'Intro paragraph at the top of the note.\n' +
  '\n' +
  FILLER +
  '\n' +
  '## Setup\n' +
  '\n' +
  'Setup details here. Follow these steps first.\n' +
  '\n' +
  FILLER +
  '\n' +
  '## Usage\n' +
  '\n' +
  'Usage details here. This is the section to bookmark.\n' +
  '\n' +
  FILLER +
  '\n' +
  '## Reference\n' +
  '\n' +
  'Reference details here. Look things up here.\n' +
  '\n' +
  FILLER +
  '\n' +
  '## Appendix\n' +
  '\n' +
  'Appendix details here. This is the last section.\n' +
  '\n' +
  FILLER;

function seedLongLibrary(): SeedPaths {
  return seedLibrary([{ name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] }]);
}

async function launchSeededApp(paths: SeedPaths) {
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

async function openNote(page: import('@playwright/test').Page): Promise<void> {
  await openNotebook(page, 'Seeded');
  await openGridEntry(page, 'Field Notes.md');
  await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });
}

async function placeReadingSelection(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.evaluate((wanted) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.data.includes(wanted)) {
        const range = document.createRange();
        range.setStart(node, 1);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
    }
    throw new Error(`Reading text not found: ${wanted}`);
  }, text);
}

async function readingJumpState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName ?? '',
      text: active?.textContent ?? '',
      selection: window.getSelection()?.toString() ?? '',
    };
  });
}

async function bookmarkCurrentHeading(page: import('@playwright/test').Page, expectedName: string): Promise<void> {
  await pressShortcut(page, 'Control+Alt+H');
  const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
  await expect(nameDialog).toBeVisible();
  await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue(expectedName);
  await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
  await expect(nameDialog).toBeHidden({ timeout: 30000 });
}

async function bookmarkCurrentPosition(page: import('@playwright/test').Page, shortName: string): Promise<void> {
  await pressShortcut(page, 'Control+Alt+B');
  const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
  await expect(nameDialog).toBeVisible();
  await nameDialog.getByLabel('Bookmark name').fill(shortName);
  await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
  await expect(nameDialog).toBeHidden({ timeout: 30000 });
}

async function moveToSection(page: import('@playwright/test').Page, text: string): Promise<void> {
  const paragraph = page.locator('p', { hasText: text }).first();
  await expect(paragraph).toBeVisible({ timeout: 30000 });
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.click({ position: { x: 10, y: 8 } });
  await placeReadingSelection(page, text);
  await page.waitForTimeout(1000);
}

/** Click the list button via element.click(), with no prior focus on it. */
async function clickListBookmarkFocusless(page: import('@playwright/test').Page, label: string): Promise<void> {
  const found = await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(wanted),
    );
    if (!button) return 'missing';
    const before = (document.activeElement as HTMLElement | null)?.tagName ?? '';
    button.click();
    return before;
  }, label);
  expect(found).not.toBe('missing');
}

async function createBothBookmarks(page: import('@playwright/test').Page): Promise<void> {
  await placeReadingSelection(page, 'Usage details here.');
  await bookmarkCurrentHeading(page, 'Usage');
  await placeReadingSelection(page, 'Reference details here.');
  await bookmarkCurrentPosition(page, 'Reference details');
}

test('focus-less click on the list button lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await createBothBookmarks(page);
    await moveToSection(page, 'Appendix details here.');
    await clickListBookmarkFocusless(page, 'Usage — Field Notes.md');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('activation with the note closed opens it and lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await createBothBookmarks(page);
    await moveToSection(page, 'Appendix details here.');
    // Close the note tab: the list falls back to the library scope.
    const closeButton = page.getByRole('button', { name: 'Close Field Notes' });
    await closeButton.click();
    await expect(page.getByRole('button', { name: 'Usage — Field Notes.md' })).toBeVisible({
      timeout: 30000,
    });
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await bookmarkButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('click while DOM focus sits on a document heading lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await createBothBookmarks(page);
    await moveToSection(page, 'Appendix details here.');
    // Put DOM focus on the Appendix heading itself (the state after a
    // previous jump, where focus rests on a heading in the document),
    // then click the list button without focusing it. A plain click
    // does not focus a heading, so focus it directly.
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find(
        (item) => item.textContent?.trim() === 'Appendix',
      ) as HTMLElement | undefined;
      if (!heading) throw new Error('Appendix heading not found');
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
    });
    await expect(page.getByRole('heading', { name: 'Appendix', level: 2 })).toBeFocused();
    await clickListBookmarkFocusless(page, 'Usage — Field Notes.md');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('activation immediately after reopening lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await createBothBookmarks(page);
    await moveToSection(page, 'Appendix details here.');
    const closeButton = page.getByRole('button', { name: 'Close Field Notes' });
    await closeButton.click();
    await expect(page.getByRole('button', { name: 'Usage — Field Notes.md' })).toBeVisible({
      timeout: 30000,
    });
    // Reopen from the grid and activate at once, no settle wait: the
    // saved-reading-position resume is still in flight.
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await bookmarkButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('chaining a second list activation straight after the first lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await createBothBookmarks(page);
    await moveToSection(page, 'Appendix details here.');
    const usageButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await usageButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    // Straight to the position bookmark, no move away in between.
    const referenceButton = page.getByRole('button', { name: 'Reference details (position)' });
    await referenceButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({
        tag: 'P',
        text: 'Reference details here. Look things up here.',
        selection: 'Reference details here.',
      });
    await expect(statusLine(page)).toContainText('Jumped to Reference.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('activation in a note with no provenance record lands and stays', async () => {
  // A note whose origin record is gone (cloud sync replacing the file
  // drops it — the same mechanism as the template-picker finding) is
  // unmanaged, so openEntry awaits the encryption check before its
  // already-open early return: the pending-focus request it issues
  // afterwards can land after the bookmark landing and yank focus
  // back to the top of the note.
  test.setTimeout(180000);
  const paths = seedLongLibrary();
  writeFileSync(
    path.join(paths.libraryDir, '.a11ynotebook', 'provenance.json'),
    JSON.stringify({ version: 1, records: {} }, null, 2),
    'utf8',
  );
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page);
    await createBothBookmarks(page);
    await moveToSection(page, 'Appendix details here.');
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await bookmarkButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    const start = Date.now();
    while (Date.now() - start < 3000) {
      expect(await readingJumpState(page)).toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
      await page.waitForTimeout(250);
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('activation of a file-level (anchor-less) bookmark moves focus', async () => {
  // The toolbar "Bookmark note" toggle saves a bookmark with no
  // anchor: it points at the file, not a spot. Activating it from
  // the list only opens the note — no jump, no announcement — while
  // Ctrl+Alt+J silently skips it and jumps among anchored bookmarks.
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await moveToSection(page, 'Appendix details here.');
    // The toolbar "Bookmark note" button only shows when command
    // buttons are enabled (off by default), so toggle the file-level
    // bookmark through the palette instead.
    await runPaletteCommand(page, 'Toggle note bookmark');
    await expect(statusLine(page)).toContainText('Note bookmarked.', { timeout: 30000 });
    // Where reading stopped, as the app tracked it — read it back
    // instead of assuming a section, so the test does not depend on
    // scroll geometry (a minimal scroll can leave the tracker on the
    // previous section).
    const savedHeading = await page.evaluate(async () => {
      const bookmarks = (await window.a11yNotebook?.vault.getBookmarks()) ?? [];
      const fileLevel = bookmarks.find((bookmark) => !bookmark.anchor);
      if (!fileLevel) return null;
      const saved = await window.a11yNotebook?.vault.getReadingPosition(fileLevel.path);
      return saved?.heading ?? null;
    });
    expect(savedHeading).not.toBeNull();
    const bookmarkButton = page.getByRole('button', { name: 'Field Notes', exact: true });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.focus();
    await page.keyboard.press('Enter');
    // The file-level bookmark has no exact spot: the jump lands the
    // reader at the saved reading position and announces the heading
    // it landed under, the way an anchored bookmark announces its
    // heading.
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: savedHeading ?? '', selection: savedHeading ?? '' });
    await expect(statusLine(page)).toContainText(`Jumped to ${savedHeading}.`, { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
