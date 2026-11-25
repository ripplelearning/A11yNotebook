import { test, expect, _electron as electron } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  openGridEntry,
  openNotebook,
  pressShortcut,
  seedLibrary,
  statusLine,
  waitForApp,
} from './helpers';

// Packaged-build check for the 1.9.22 bookmark-jump retest: the same
// scenario as e2e/bookmark-jump-retest.spec.ts, driven against the
// locally packaged Linux build instead of the Vite dev server, because
// a shipped-build-only difference has bitten this project before (the
// 1.9.21 CSP case). Run with PACKAGED_APP set to the unpacked binary,
// e.g. PACKAGED_APP=$PWD/release/linux-unpacked/a11y-notebook. Skipped
// when PACKAGED_APP is unset (CI runs the dev-server specs instead).

const PACKAGED_APP = process.env.PACKAGED_APP ?? '';

const NOTE_CONTENT =
  '# Field Notes\n' +
  '\n' +
  'Intro paragraph at the top of the note.\n' +
  '\n' +
  '## Setup\n' +
  '\n' +
  'Setup details here. Follow these steps first.\n' +
  '\n' +
  '## Usage\n' +
  '\n' +
  'Usage details here. This is the section to bookmark.\n' +
  'More usage text on the next line of the same paragraph,\n' +
  'and a third line that continues the thought here.\n' +
  '\n' +
  '## Reference\n' +
  '\n' +
  'Reference details here. Look things up here.\n';

const THIRD_LINE = 'and a third line that continues the thought here.';
const THIRD_LINE_START = NOTE_CONTENT.indexOf(THIRD_LINE);

test('packaged build: her exact scenario lands on the exact line', async () => {
  test.skip(!PACKAGED_APP, 'PACKAGED_APP is unset; packaged check runs locally only.');
  test.setTimeout(180000);
  const paths = seedLibrary([
    { name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] },
  ]);
  const app = await electron.launch({
    executablePath: PACKAGED_APP,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
  });
  const page = await app.firstWindow();
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    const readingJumpState = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const selection = window.getSelection();
        return {
          tag: active?.tagName ?? '',
          text: active?.textContent ?? '',
          selection: selection?.toString() ?? '',
          anchorOffset: selection?.anchorOffset ?? -1,
          anchorText: selection?.anchorNode?.textContent ?? '',
        };
      });
    const clickToPlaceCaret = async (wanted: string) => {
      const point = await page.evaluate((text) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          const at = node.data.indexOf(text);
          if (at >= 0) {
            const range = document.createRange();
            range.setStart(node, at + 2);
            range.setEnd(node, at + 3);
            const rect = range.getClientRects()[0];
            if (!rect) throw new Error(`No rect for reading text: ${text}`);
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, nodeStart: at };
          }
        }
        throw new Error(`Reading text not found: ${text}`);
      }, wanted);
      await page.mouse.click(point.x, point.y);
      const placed = await page.evaluate(() => ({
        anchorOffset: window.getSelection()?.anchorOffset ?? -1,
      }));
      expect(placed.anchorOffset).toBeGreaterThanOrEqual(point.nodeStart);
      expect(placed.anchorOffset).toBeLessThanOrEqual(point.nodeStart + wanted.length);
    };
    await clickToPlaceCaret(THIRD_LINE);
    await pressShortcut(page, 'Control+Alt+B');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await nameDialog.getByLabel('Bookmark name').fill('My usage spot');
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Bookmarked "My usage spot".', { timeout: 30000 });
    const stored = await page.evaluate(() => window.a11yNotebook?.vault.getBookmarks() ?? []);
    const mine = stored.find((bookmark) => bookmark.name === 'My usage spot');
    expect(mine).toBeDefined();
    expect(mine?.anchor).toEqual({ kind: 'offset', offset: THIRD_LINE_START });
    // Variant A: no DOM move since the bookmark was made.
    await pressShortcut(page, 'Control+Alt+J');
    await expect(page.getByRole('dialog', { name: 'Name bookmark' })).toHaveCount(0, {
      timeout: 5000,
    });
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'and a third' });
    const landedA = await readingJumpState();
    expect(landedA.text).toContain(THIRD_LINE);
    expect(landedA.anchorText.indexOf('and a third line')).toBeLessThanOrEqual(landedA.anchorOffset);
    await expect(statusLine(page)).toContainText('Jumped to My usage spot.', { timeout: 30000 });
    // Variant B: move to another section, then jump back.
    await clickToPlaceCaret('Reference details here.');
    await pressShortcut(page, 'Control+Alt+J');
    await expect(page.getByRole('dialog', { name: 'Name bookmark' })).toHaveCount(0, {
      timeout: 5000,
    });
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'and a third' });
    const landedB = await readingJumpState();
    expect(landedB.text).toContain(THIRD_LINE);
    expect(landedB.anchorText.indexOf('and a third line')).toBeLessThanOrEqual(landedB.anchorOffset);
    await expect(statusLine(page)).toContainText('Jumped to My usage spot.', { timeout: 30000 });
  } finally {
    await closeApp(app, paths);
  }
});

test('packaged build: a second bookmark from the same caret stores the exact line', async () => {
  test.skip(!PACKAGED_APP, 'PACKAGED_APP is unset; packaged check runs locally only.');
  test.setTimeout(180000);
  const paths = seedLibrary([
    { name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] },
  ]);
  const app = await electron.launch({
    executablePath: PACKAGED_APP,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
  });
  const page = await app.firstWindow();
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    const readingJumpState = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const selection = window.getSelection();
        return {
          tag: active?.tagName ?? '',
          text: active?.textContent ?? '',
          selection: selection?.toString() ?? '',
          anchorOffset: selection?.anchorOffset ?? -1,
          anchorText: selection?.anchorNode?.textContent ?? '',
        };
      });
    const clickToPlaceCaret = async (wanted: string) => {
      const point = await page.evaluate((text) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          const at = node.data.indexOf(text);
          if (at >= 0) {
            const range = document.createRange();
            range.setStart(node, at + 2);
            range.setEnd(node, at + 3);
            const rect = range.getClientRects()[0];
            if (!rect) throw new Error(`No rect for reading text: ${text}`);
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, nodeStart: at };
          }
        }
        throw new Error(`Reading text not found: ${text}`);
      }, wanted);
      await page.mouse.click(point.x, point.y);
      const placed = await page.evaluate(() => ({
        anchorOffset: window.getSelection()?.anchorOffset ?? -1,
      }));
      expect(placed.anchorOffset).toBeGreaterThanOrEqual(point.nodeStart);
      expect(placed.anchorOffset).toBeLessThanOrEqual(point.nodeStart + wanted.length);
    };
    await clickToPlaceCaret(THIRD_LINE);
    await pressShortcut(page, 'Control+Alt+B');
    const firstDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(firstDialog).toBeVisible();
    await expect(firstDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await firstDialog.getByLabel('Bookmark name').fill('First spot');
    await firstDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(firstDialog).toBeHidden({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Bookmarked "First spot".', { timeout: 30000 });
    // The reader has not moved: the second naming dialog must suggest
    // the same line, not the first heading. It is cancelled, not saved:
    // the store drops a second bookmark at an anchor that already has
    // one, so saving it could not prove the set.
    await pressShortcut(page, 'Control+Alt+B');
    const secondDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await secondDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(secondDialog).toBeHidden({ timeout: 30000 });
    // Cancelling must also put the reading position back, so Ctrl+Alt+J
    // reads the reader's real position and jumps to the first bookmark.
    const afterCancel = await readingJumpState();
    expect(afterCancel.anchorText).toContain(THIRD_LINE);
    expect(afterCancel.anchorOffset).toBeGreaterThanOrEqual(
      afterCancel.anchorText.indexOf(THIRD_LINE),
    );
    await pressShortcut(page, 'Control+Alt+J');
    await expect
      .poll(() => readingJumpState(), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'and a third' });
    const landed = await readingJumpState();
    expect(landed.text).toContain(THIRD_LINE);
    await expect(statusLine(page)).toContainText('Jumped to First spot.', { timeout: 30000 });
  } finally {
    await closeApp(app, paths);
  }
});
