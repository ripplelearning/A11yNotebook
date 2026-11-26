import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
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

/**
 * Bookmarks LIST activation in markdown notes (1.9.23 retest item 5):
 * Ctrl+Alt+J navigation works, but activating a bookmark from the
 * Bookmarks list under the Bookmarks heading "still does not work" —
 * it does not move the screen reader's focus to the bookmarked place.
 * This spec reproduces Tristen's exact steps, which the existing
 * bookmark-markdown spec does not cover: a long note that actually
 * scrolls, bookmarks created with Alt+Ctrl+B and Alt+Ctrl+H, a real
 * move to another section (focus + selection + scroll in the reading
 * view, with the debounced reading-position save firing), then
 * keyboard activation (Enter on the focused list button) — and a
 * sustained check that focus STAYS on the bookmarked spot instead of
 * drifting back to the top or the saved reading position.
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

interface LaunchedApp {
  app: ElectronApplication;
  page: import('@playwright/test').Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchSeededApp(paths: SeedPaths): Promise<LaunchedApp> {
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

/** Place the DOM selection inside rendered reading text, the way a screen reader's virtual cursor leaves it. */
async function placeReadingSelection(
  page: import('@playwright/test').Page,
  text: string,
  occurrence = 0,
): Promise<void> {
  await page.evaluate(
    ({ wanted, which }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.data.includes(wanted)) nodes.push(node);
      }
      const target = nodes[which];
      if (!target) throw new Error(`Reading text not found: ${wanted} (occurrence ${which})`);
      const range = document.createRange();
      range.setStart(target, 1);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { wanted: text, which: occurrence },
  );
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

/**
 * Move to another section the way a reader does: scroll it into view
 * and click into its text, so focus, selection, scroll position, and
 * the debounced reading-position save all reflect the new section —
 * not just a synthetic selection set.
 */
async function moveToSection(page: import('@playwright/test').Page, text: string): Promise<void> {
  const paragraph = page.locator('p', { hasText: text }).first();
  await expect(paragraph).toBeVisible({ timeout: 30000 });
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.click({ position: { x: 10, y: 8 } });
  await placeReadingSelection(page, text);
  // The reading-position save is debounced 600ms: let it fire, so the
  // saved position is the new section when the list jump runs.
  await page.waitForTimeout(1000);
}

/** Keyboard-activate a Bookmarks list button: focus it, press Enter. */
async function activateListBookmark(page: import('@playwright/test').Page, buttonName: string | RegExp): Promise<void> {
  const bookmarkButton = page.getByRole('button', { name: buttonName });
  await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
  await bookmarkButton.focus();
  await expect(bookmarkButton).toBeFocused();
  await page.keyboard.press('Enter');
}

/** Focus must land on the bookmarked spot and stay there. */
async function expectLandedAndStays(
  page: import('@playwright/test').Page,
  expected: { tag: string; text: string; selection: string },
  expectedStatus: string,
): Promise<void> {
  await expect.poll(() => readingJumpState(page), { timeout: 10000 }).toEqual(expected);
  await expect(statusLine(page)).toContainText(expectedStatus, { timeout: 30000 });
  const start = Date.now();
  while (Date.now() - start < 3000) {
    expect(await readingJumpState(page)).toEqual(expected);
    await page.waitForTimeout(250);
  }
}

test('bookmarks list hides its bullets but stays a list', async () => {
  // 1.9.23 retest item 5: the bullets in front of each bookmark list
  // item can take a screen reader's activation instead of the bookmark
  // button, so activating from the list does nothing. The list stays
  // an unordered list — only the markers are hidden.
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    const listInfo = await page.evaluate(() => {
      const list = document.querySelector('section[aria-labelledby="bookmarks-heading"] ul');
      if (!list) return null;
      const style = window.getComputedStyle(list);
      return {
        tag: list.tagName,
        role: list.getAttribute('role'),
        listStyleType: style.listStyleType,
        items: list.querySelectorAll('li').length,
      };
    });
    expect(listInfo).toEqual({ tag: 'UL', role: 'list', listStyleType: 'none', items: 1 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('list activation after moving to another section lands on the heading bookmark and stays', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    // Create the bookmarks with Alt+Ctrl+H and Alt+Ctrl+B, as Tristen does.
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await expect(statusLine(page)).toContainText('Bookmarked heading "Usage".', { timeout: 30000 });
    await placeReadingSelection(page, 'Reference details here.');
    await bookmarkCurrentPosition(page, 'Reference details');
    await expect(statusLine(page)).toContainText('Bookmarked "Reference details".', { timeout: 30000 });
    // Move to another section for real, then activate from the list.
    await moveToSection(page, 'Appendix details here.');
    await activateListBookmark(page, 'Usage — Field Notes.md');
    await expectLandedAndStays(page, { tag: 'H2', text: 'Usage', selection: 'Usage' }, 'Jumped to Usage.');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('list activation after moving to another section lands on the position bookmark line and stays', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await placeReadingSelection(page, 'Reference details here.');
    await bookmarkCurrentPosition(page, 'Reference details');
    await moveToSection(page, 'Appendix details here.');
    await activateListBookmark(page, 'Reference details (position)');
    await expectLandedAndStays(
      page,
      {
        tag: 'P',
        text: 'Reference details here. Look things up here.',
        selection: 'Reference details here.',
      },
      'Jumped to Reference.',
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('list activation in edit mode after moving the caret lands on the heading and stays', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await pressShortcut(page, 'Control+E');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toBeFocused();
    await page.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea.markdown-editor');
      if (!area) throw new Error('Markdown editor not found');
      const offset = area.value.indexOf('Usage details here.');
      area.focus();
      area.setSelectionRange(offset, offset);
    });
    await bookmarkCurrentHeading(page, 'Usage');
    // Caret to the last section, then activate from the list.
    await expect(editor).toBeFocused({ timeout: 30000 });
    await page.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea.markdown-editor');
      if (!area) throw new Error('Markdown editor not found');
      const offset = area.value.indexOf('Appendix details here.');
      area.focus();
      area.setSelectionRange(offset, offset);
    });
    await page.waitForTimeout(1000);
    await activateListBookmark(page, 'Usage — Field Notes.md');
    const headingStart = NOTE_CONTENT.indexOf('## Usage') + '## '.length;
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const area = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
            return {
              tag: area?.tagName ?? '',
              start: area?.selectionStart ?? -1,
              end: area?.selectionEnd ?? -1,
              selected: area ? area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0) : '',
            };
          }),
        { timeout: 10000 },
      )
      .toEqual({ tag: 'TEXTAREA', start: headingStart, end: headingStart + 5, selected: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('activation at the start of a bookmark line lands on the bookmark', async () => {
  // 1.9.23 retest item 5: a screen reader's virtual cursor rests at the
  // start of a list item's line, and a browse-mode activation lands
  // there — where the bullet marker sits in front of the bookmark
  // button. Clicking that spot must activate the bookmark, not land on
  // the marker (or the list's padding) and do nothing. With the markers
  // hidden the button starts the line, so the same spot hits the
  // button. On unfixed code this click lands in the list's padding
  // where the marker lives and nothing happens.
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await expect(statusLine(page)).toContainText('Bookmarked heading "Usage".', { timeout: 30000 });
    await moveToSection(page, 'Appendix details here.');
    const list = page.locator('section[aria-labelledby="bookmarks-heading"] ul');
    await expect(list).toBeVisible({ timeout: 30000 });
    await list.scrollIntoViewIfNeeded();
    const box = await list.boundingBox();
    if (!box) throw new Error('Bookmarks list has no bounding box');
    const firstItem = list.locator('li').first();
    const itemBox = await firstItem.boundingBox();
    if (!itemBox) throw new Error('First bookmark item has no bounding box');
    // A few pixels inside the list's left edge, on the first item's
    // row: the bullet's spot on unfixed code, the button's start
    // once the markers are hidden.
    await page.mouse.click(box.x + 6, itemBox.y + itemBox.height / 2);
    await expectLandedAndStays(page, { tag: 'H2', text: 'Usage', selection: 'Usage' }, 'Jumped to Usage.');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
