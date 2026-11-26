import { test, expect, _electron as electron } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  openGridEntry,
  openNotebook,
  pressShortcut,
  seedLibrary,
  statusLine,
  switchView,
  waitForApp,
} from './helpers';

// Packaged-build check for the 1.9.23 retest item 5 (Bookmarks LIST
// activation): the same scenario as e2e/bookmark-list-activation.spec.ts,
// driven against the locally packaged Linux build instead of the Vite
// dev server, because a shipped-build-only difference has bitten this
// project before (the 1.9.21 CSP case). Run with PACKAGED_APP set to
// the unpacked binary, e.g.
// PACKAGED_APP=$PWD/release/linux-unpacked/a11y-notebook.
// Skipped when PACKAGED_APP is unset (CI runs the dev-server specs).

const PACKAGED_APP = process.env.PACKAGED_APP ?? '';

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

test('packaged build: list activation lands on the heading and position bookmarks and stays', async () => {
  test.skip(!PACKAGED_APP, 'PACKAGED_APP is unset; packaged check runs locally only.');
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] }]);
  const app = await electron.launch({
    executablePath: PACKAGED_APP,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
  });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });

    const placeReadingSelection = async (text: string) => {
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
    };
    const readingJumpState = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return {
          tag: active?.tagName ?? '',
          text: active?.textContent ?? '',
          selection: window.getSelection()?.toString() ?? '',
        };
      });

    // The bullets are hidden but the list stays a list (1.9.23
    // retest item 5): the markers are what can take a screen
    // reader's activation instead of the bookmark button.
    const listInfo = await page.evaluate(() => {
      const list = document.querySelector('section[aria-labelledby="bookmarks-heading"] ul');
      if (!list) return null;
      return {
        tag: list.tagName,
        role: list.getAttribute('role'),
        listStyleType: window.getComputedStyle(list).listStyleType,
      };
    });
    expect(listInfo).toEqual({ tag: 'UL', role: 'list', listStyleType: 'none' });

    // Heading bookmark on Usage, position bookmark in Reference.
    await placeReadingSelection('Usage details here.');
    await pressShortcut(page, 'Control+Alt+H');
    let nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await placeReadingSelection('Reference details here.');
    await pressShortcut(page, 'Control+Alt+B');
    nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await nameDialog.getByLabel('Bookmark name').fill('Reference details');
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });

    // Move to the Appendix section for real: scroll + click into text,
    // then let the debounced reading-position save fire.
    const paragraph = page.locator('p', { hasText: 'Appendix details here.' }).first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ position: { x: 10, y: 8 } });
    await placeReadingSelection('Appendix details here.');
    await page.waitForTimeout(1000);

    // Keyboard-activate the heading bookmark from the list.
    const headingButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await expect(headingButton).toBeVisible({ timeout: 30000 });
    await headingButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });

    // Move away again, then keyboard-activate the position bookmark.
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ position: { x: 10, y: 8 } });
    await placeReadingSelection('Appendix details here.');
    await page.waitForTimeout(1000);
    const positionButton = page.getByRole('button', { name: 'Reference details (position)' });
    await expect(positionButton).toBeVisible({ timeout: 30000 });
    await positionButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toEqual({
        tag: 'P',
        text: 'Reference details here. Look things up here.',
        selection: 'Reference details here.',
      });
    await expect(statusLine(page)).toContainText('Jumped to Reference.', { timeout: 30000 });
    // Focus must stay on the bookmarked spot afterwards.
    const start = Date.now();
    while (Date.now() - start < 3000) {
      expect(await readingJumpState()).toEqual({
        tag: 'P',
        text: 'Reference details here. Look things up here.',
        selection: 'Reference details here.',
      });
      await page.waitForTimeout(250);
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('packaged build: list activation while the grid view is current switches to the note and lands', async () => {
  test.skip(!PACKAGED_APP, 'PACKAGED_APP is unset; packaged check runs locally only.');
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] }]);
  const app = await electron.launch({
    executablePath: PACKAGED_APP,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
  });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });
    const placeReadingSelection = async (text: string) => {
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
    };
    const readingJumpState = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return {
          tag: active?.tagName ?? '',
          text: active?.textContent ?? '',
          selection: window.getSelection()?.toString() ?? '',
        };
      });
    await placeReadingSelection('Usage details here.');
    await pressShortcut(page, 'Control+Alt+H');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    const paragraph = page.locator('p', { hasText: 'Appendix details here.' }).first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ position: { x: 10, y: 8 } });
    await placeReadingSelection('Appendix details here.');
    await page.waitForTimeout(1000);
    // Switch to the Notes and Files grid: the note stays open in a
    // tab and the list stays scoped to it. Activating from here also
    // switches the tab and runs the mode and resume effects in the
    // same commit as the jump.
    await switchView(page, 'Control+2', async () =>
      page.getByRole('gridcell', { name: 'Field Notes.md', exact: true }).count(),
    );
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('packaged build: list activation by a focus-less click lands on the bookmark', async () => {
  // A screen reader in browse mode routes activation as a click without
  // moving DOM focus onto the button first, so the jump must not depend
  // on the button having had focus.
  test.skip(!PACKAGED_APP, 'PACKAGED_APP is unset; packaged check runs locally only.');
  test.setTimeout(180000);
  const paths = seedLibrary([{ name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] }]);
  const app = await electron.launch({
    executablePath: PACKAGED_APP,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
  });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });
    const placeReadingSelection = async (text: string) => {
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
    };
    const readingJumpState = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return {
          tag: active?.tagName ?? '',
          text: active?.textContent ?? '',
          selection: window.getSelection()?.toString() ?? '',
        };
      });
    await placeReadingSelection('Usage details here.');
    await pressShortcut(page, 'Control+Alt+H');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    const paragraph = page.locator('p', { hasText: 'Appendix details here.' }).first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ position: { x: 10, y: 8 } });
    await placeReadingSelection('Appendix details here.');
    await page.waitForTimeout(1000);
    // Click the list button without focusing it first.
    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((item) =>
        item.textContent?.includes('Usage — Field Notes.md'),
      );
      if (!button) return 'missing';
      const before = (document.activeElement as HTMLElement | null)?.tagName ?? '';
      button.click();
      return before;
    });
    expect(clicked).not.toBe('missing');
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
