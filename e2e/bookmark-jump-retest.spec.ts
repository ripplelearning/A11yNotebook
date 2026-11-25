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
 * 1.9.22 retest reproduction: "In markdown notes, I selected text,
 * pressed alt-ctrl-b, named the bookmark, moved to another section,
 * then pressed alt-ctrl-j, but it only moved focus to the heading
 * before the text that I bookmarked; it should have moved focus to the
 * exact location that I bookmarked." And: "Both Alt-ctrl-h and
 * alt-ctrl-j are setting bookmarks, leaving no shortcut for jumping
 * to the next bookmark."
 *
 * The earlier bookmark-markdown scenarios place the reading selection
 * with page.evaluate and move it to the top of the note before
 * jumping. This spec reproduces her flow instead: a real mouse click
 * places the caret (a keyboard or screen-reader user's reading
 * position — Shift+Arrow does not extend a selection in a non-editable
 * document, verified by probe), the naming dialog is filled, and the
 * jump runs with the selection left where the bookmark was made or
 * moved to another section by a real click. A jump is only a pass when
 * focus AND the DOM selection land on the exact bookmarked line. The
 * stored anchor is read back too: a bookmark stored at its section
 * heading's offset fails at set time, not at jump time.
 */

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

function seedMarkdownLibrary(): SeedPaths {
  return seedLibrary([
    {
      name: 'Seeded',
      files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }],
    },
  ]);
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
  await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({
    timeout: 30000,
  });
}

async function readingJumpState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
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
}

/**
 * Click into the rendered text at `wanted`, the way a mouse click does:
 * a real click places a collapsed caret — it does NOT extend a
 * selection, because in a non-editable document Chromium moves the
 * caret with neither plain arrows nor Shift+arrows (verified by probe:
 * after a click the caret sits at the clicked offset, Shift+ArrowRight
 * leaves it collapsed there, and no app keydown handler preventDefaults
 * the keys). A screen reader's virtual cursor likewise leaves the DOM
 * selection at the reading position, so the bookmark set/jump path must
 * work from the caret alone — a non-empty selection is not required.
 * Returns the caret's text-node offset, for the caller to assert.
 */
async function clickToPlaceCaret(
  page: import('@playwright/test').Page,
  wanted: string,
): Promise<{ anchorOffset: number; nodeText: string }> {
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
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          nodeStart: at,
          nodeText: node.data,
        };
      }
    }
    throw new Error(`Reading text not found: ${text}`);
  }, wanted);
  await page.mouse.click(point.x, point.y);
  const placed = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      anchorOffset: selection?.anchorOffset ?? -1,
      anchorText: selection?.anchorNode?.textContent ?? '',
    };
  });
  // The caret must sit inside the wanted text: the click targets the
  // third character of the wanted run, and Chromium snaps the caret to
  // the nearest character boundary, so it lands one char either side.
  expect(placed.anchorOffset).toBeGreaterThanOrEqual(point.nodeStart);
  expect(placed.anchorOffset).toBeLessThanOrEqual(point.nodeStart + wanted.length);
  expect(placed.anchorText).toBe(point.nodeText);
  return { anchorOffset: placed.anchorOffset, nodeText: placed.anchorText };
}

async function storedBookmarks(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.a11yNotebook?.vault.getBookmarks() ?? []);
}

test('her exact scenario: select text, Ctrl+Alt+B, move away, Ctrl+Alt+J lands on the exact line', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page);
    // A real mouse click places the caret in the third line of the
    // Usage paragraph — that is the reading position a keyboard or
    // screen-reader user bookmarks from (Shift+Arrow does not extend a
    // selection in a non-editable document, and the virtual cursor
    // likewise leaves the DOM selection at the reading position).
    await clickToPlaceCaret(page, THIRD_LINE);
    // Ctrl+Alt+B: the naming dialog must suggest the exact line, not
    // the section heading — that is what the bookmark stores.
    await pressShortcut(page, 'Control+Alt+B');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await nameDialog.getByLabel('Bookmark name').fill('My usage spot');
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Bookmarked "My usage spot".', { timeout: 30000 });
    // The stored anchor must be the exact line's offset, not the
    // Usage heading's offset.
    const stored = await storedBookmarks(page);
    const mine = stored.find((bookmark) => bookmark.name === 'My usage spot');
    expect(mine).toBeDefined();
    expect(mine?.anchor).toEqual({ kind: 'offset', offset: THIRD_LINE_START });
    // Variant A: the reader has NOT moved the DOM selection since the
    // bookmark was made — a screen reader's virtual cursor moves
    // without touching it. Ctrl+Alt+J must still jump to the
    // bookmarked line itself (wrapping to it), and must not open the
    // naming dialog (J must jump, not set a bookmark). The landing
    // selects the line's first words, the Find way — at most three, so
    // the selection here is 'and a third', not the whole line.
    await pressShortcut(page, 'Control+Alt+J');
    await expect(page.getByRole('dialog', { name: 'Name bookmark' })).toHaveCount(0, {
      timeout: 5000,
    });
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'and a third' });
    const landedA = await readingJumpState(page);
    expect(landedA.text).toContain(THIRD_LINE);
    // The selection must sit inside the third line's text, not the
    // paragraph's first line.
    expect(landedA.anchorText.indexOf('and a third line')).toBeLessThanOrEqual(landedA.anchorOffset);
    await expect(statusLine(page)).toContainText('Jumped to My usage spot.', { timeout: 30000 });
    // Variant B: move to another section (a real click into Reference),
    // then Ctrl+Alt+J again — it must come back to the exact line.
    await clickToPlaceCaret(page, 'Reference details here.');
    await pressShortcut(page, 'Control+Alt+J');
    await expect(page.getByRole('dialog', { name: 'Name bookmark' })).toHaveCount(0, {
      timeout: 5000,
    });
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'and a third' });
    const landedB = await readingJumpState(page);
    expect(landedB.text).toContain(THIRD_LINE);
    expect(landedB.anchorText.indexOf('and a third line')).toBeLessThanOrEqual(landedB.anchorOffset);
    await expect(statusLine(page)).toContainText('Jumped to My usage spot.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a second bookmark from the same caret stores the exact line, not the first heading', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page);
    await clickToPlaceCaret(page, THIRD_LINE);
    await pressShortcut(page, 'Control+Alt+B');
    const firstDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(firstDialog).toBeVisible();
    await expect(firstDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await firstDialog.getByLabel('Bookmark name').fill('First spot');
    await firstDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(firstDialog).toBeHidden({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Bookmarked "First spot".', { timeout: 30000 });
    // The naming dialog destroys the document selection (it ends up in
    // the status bar), so without the selection being put back, the
    // second set from the same caret falls back to the first heading:
    // the dialog suggests 'Field Notes', and a bookmark saved from it
    // stores offset 0, so a jump to it lands on the H1 — the heading
    // before the text. The reader has not moved: the dialog must
    // suggest the same line. The second dialog is cancelled, not
    // saved: the store drops a second bookmark at an anchor that
    // already has one, so saving it could not prove the set.
    await pressShortcut(page, 'Control+Alt+B');
    const secondDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await secondDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(secondDialog).toBeHidden({ timeout: 30000 });
    // Cancelling must also put the reading position back: the
    // selection sits in the third line's text again, so Ctrl+Alt+J
    // reads the reader's real position and jumps to the first bookmark.
    const afterCancel = await readingJumpState(page);
    expect(afterCancel.anchorText).toContain(THIRD_LINE);
    expect(afterCancel.anchorOffset).toBeGreaterThanOrEqual(
      afterCancel.anchorText.indexOf(THIRD_LINE),
    );
    await pressShortcut(page, 'Control+Alt+J');
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'and a third' });
    const landed = await readingJumpState(page);
    expect(landed.text).toContain(THIRD_LINE);
    await expect(statusLine(page)).toContainText('Jumped to First spot.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Ctrl+Alt+J cycles bookmarks and never opens the naming dialog', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page);
    // A heading bookmark on Usage and a position bookmark on the
    // third line, both made from a real click-placed caret.
    await clickToPlaceCaret(page, 'Usage details here.');
    await pressShortcut(page, 'Control+Alt+H');
    const headingDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(headingDialog).toBeVisible();
    await expect(headingDialog.getByLabel('Bookmark name')).toHaveValue('Usage');
    await headingDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(headingDialog).toBeHidden({ timeout: 30000 });
    await clickToPlaceCaret(page, THIRD_LINE);
    await pressShortcut(page, 'Control+Alt+B');
    const positionDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(positionDialog).toBeVisible();
    await expect(positionDialog.getByLabel('Bookmark name')).toHaveValue(THIRD_LINE);
    await positionDialog.getByLabel('Bookmark name').fill('Third line spot');
    await positionDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(positionDialog).toBeHidden({ timeout: 30000 });
    // From the bookmarked line, J must go to the next bookmark — and
    // each press must jump, never set: no naming dialog at any point.
    for (let i = 0; i < 3; i += 1) {
      await pressShortcut(page, 'Control+Alt+J');
      await expect(page.getByRole('dialog', { name: 'Name bookmark' })).toHaveCount(0, {
        timeout: 5000,
      });
    }
    await expect(statusLine(page)).toContainText('Jumped to', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('list activation in edit mode moves the textarea selection to each bookmark', async () => {
  test.setTimeout(180000);
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page);
    await pressShortcut(page, 'Control+E');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toBeFocused();
    // Caret inside the Usage section with the keyboard, then bookmark
    // its heading; caret inside the Reference section, then bookmark
    // the exact line.
    await page.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea.markdown-editor');
      if (!area) throw new Error('Markdown editor not found');
      area.focus();
      const offset = area.value.indexOf('Usage details here.');
      area.setSelectionRange(offset, offset);
    });
    await pressShortcut(page, 'Control+Alt+H');
    const headingDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(headingDialog).toBeVisible();
    await headingDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(headingDialog).toBeHidden({ timeout: 30000 });
    await page.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea.markdown-editor');
      if (!area) throw new Error('Markdown editor not found');
      area.focus();
      const offset = area.value.indexOf('Reference details here.');
      area.setSelectionRange(offset, offset);
    });
    await pressShortcut(page, 'Control+Alt+B');
    const positionDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(positionDialog).toBeVisible();
    await positionDialog.getByLabel('Bookmark name').fill('Reference spot');
    await positionDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(positionDialog).toBeHidden({ timeout: 30000 });
    // Activate each bookmark from the Bookmarks list while still in
    // edit mode: the textarea selection must move to the bookmark.
    const editSelection = () =>
      page.evaluate(() => {
        const area =
          document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
        return {
          tag: area?.tagName ?? '',
          start: area?.selectionStart ?? -1,
          end: area?.selectionEnd ?? -1,
          selected: area ? area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0) : '',
        };
      });
    const usageStart = NOTE_CONTENT.indexOf('## Usage') + '## '.length;
    const referenceStart = NOTE_CONTENT.indexOf('Reference details here.');
    const referenceLine = 'Reference details here. Look things up here.';
    await page.getByRole('button', { name: 'Usage — Field Notes.md' }).click();
    await expect
      .poll(() => editSelection(), { timeout: 10000 })
      .toEqual({ tag: 'TEXTAREA', start: usageStart, end: usageStart + 5, selected: 'Usage' });
    await page.getByRole('button', { name: 'Reference spot (position)' }).click();
    await expect
      .poll(() => editSelection(), { timeout: 10000 })
      .toEqual({
        tag: 'TEXTAREA',
        start: referenceStart,
        end: referenceStart + referenceLine.length,
        selected: referenceLine,
      });
    // The same two buttons in reading mode: focus and selection land
    // on the heading, then on the exact line. (The status line may
    // already report the jump the mode switch re-landed on, so the
    // mode switch is checked on the editor leaving, not the status.)
    await pressShortcut(page, 'Control+E');
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole('button', { name: 'Usage — Field Notes.md' }).click();
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toMatchObject({ tag: 'H2', text: 'Usage', selection: 'Usage' });
    await page.getByRole('button', { name: 'Reference spot (position)' }).click();
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toMatchObject({ tag: 'P', selection: 'Reference details here.' });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
