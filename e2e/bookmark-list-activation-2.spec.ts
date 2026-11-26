import { test, expect } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  pressShortcut,
  seedLibrary,
  statusLine,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * More list-activation scenarios for the 1.9.23 retest item 5:
 * activating while a view (Notes and Files grid) is current instead
 * of the note tab, activating immediately after creating the bookmark
 * (no settle wait), and activating the same bookmark twice in a row.
 * The view-current case is structurally different: the activation
 * commit also switches the tab and runs the mode and resume effects.
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

async function moveToSection(page: import('@playwright/test').Page, text: string): Promise<void> {
  const paragraph = page.locator('p', { hasText: text }).first();
  await expect(paragraph).toBeVisible({ timeout: 30000 });
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.click({ position: { x: 10, y: 8 } });
  await placeReadingSelection(page, text);
  await page.waitForTimeout(1000);
}

test('list activation while the grid view is current switches to the note and lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await moveToSection(page, 'Appendix details here.');
    // Switch to the Notes and Files grid: the note stays open in a
    // tab and the list stays scoped to it.
    await switchView(page, 'Control+2', async () =>
      page.getByRole('gridcell', { name: 'Field Notes.md', exact: true }).count(),
    );
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

test('list activation immediately after creating the bookmark lands', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    // No settle wait at all: move and activate right away.
    await moveToSection(page, 'Appendix details here.');
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

test('activating the same list bookmark twice in a row lands both times', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedLongLibrary());
  try {
    await openNote(page);
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await moveToSection(page, 'Appendix details here.');
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await bookmarkButton.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    // Move away again and activate the same button a second time.
    await moveToSection(page, 'Appendix details here.');
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
