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
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Bookmark jumps in markdown notes (1.9.17 retest: "Jumping to bookmarks
 * in a markdown note does not work."). The shipped verification scenario
 * only bookmarks the FIRST heading of a one-heading note, created from
 * edit mode. These scenarios cover the flows that failed: multi-heading
 * notes bookmarked from reading mode, jumps with the note closed, in
 * edit mode, or from another open note, and headings whose source text
 * differs from the rendered text — wiki links ([[Usage]]), images, and
 * other inline formatting. A jump is only a pass when focus AND the DOM
 * selection land on the bookmarked heading: focus alone does not move a
 * screen reader's virtual cursor. The 1.9.20 retest added two more
 * forms that still landed at the top of the note: image-only headings,
 * which have no text to select, and footnote headings, whose rendered
 * `Usage[1]` never matches the stored `Usage[^1]`.
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
  '\n' +
  '## Reference\n' +
  '\n' +
  'Reference details here. Look things up here.\n';

const HTML_CONTENT =
  '<h1>Field Notes</h1>\n' +
  '<p>Intro paragraph at the top of the note.</p>\n' +
  '<h2>Setup</h2>\n' +
  '<p>Setup details here.</p>\n' +
  '<h2>Usage</h2>\n' +
  '<p>Usage details here. This is the section to bookmark.</p>\n';

function seedMarkdownLibrary(): SeedPaths {
  return seedLibrary([
    {
      name: 'Seeded',
      files: [
        { name: 'Field Notes.md', content: NOTE_CONTENT },
        { name: 'Other.md', content: '# Other note\n\nSome other content here.\n' },
      ],
    },
  ]);
}

function seedHtmlLibrary(): SeedPaths {
  return seedLibrary([{ name: 'Seeded', files: [{ name: 'Field Notes.html', content: HTML_CONTENT }] }]);
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

async function openNote(page: import('@playwright/test').Page, fileName: string, heading: string): Promise<void> {
  await openNotebook(page, 'Seeded');
  await openGridEntry(page, fileName);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible({ timeout: 30000 });
}

/** Place the DOM selection inside rendered reading text, the way a screen reader's virtual cursor leaves it. */
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

/** Bookmark the heading at the reading position (Alt+Ctrl+H) and save it under its suggested name. */
async function bookmarkCurrentHeading(page: import('@playwright/test').Page, expectedName: string): Promise<void> {
  await pressShortcut(page, 'Control+Alt+H');
  const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
  await expect(nameDialog).toBeVisible();
  await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue(expectedName);
  await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
  await expect(nameDialog).toBeHidden({ timeout: 30000 });
}

async function jumpToBookmark(
  page: import('@playwright/test').Page,
  buttonName: string | RegExp,
  expectedHeading: string,
): Promise<void> {
  const bookmarkButton = page.getByRole('button', { name: buttonName });
  await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
  await bookmarkButton.click();
  await expect
    .poll(() => readingJumpState(page), { timeout: 10000 })
    .toEqual({ tag: 'H2', text: expectedHeading, selection: expectedHeading });
  await expect(statusLine(page)).toContainText(`Jumped to ${expectedHeading}.`, { timeout: 30000 });
}

test('jump to a later heading bookmarked from reading mode in a markdown note', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page, 'Field Notes.md', 'Field Notes');
    // Reading mode: put the virtual cursor in the Usage section, then bookmark it.
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await expect(statusLine(page)).toContainText('Bookmarked heading "Usage".', { timeout: 30000 });
    // Move the reading position back to the top, then jump from the Bookmarks list.
    await placeReadingSelection(page, 'Intro paragraph');
    await jumpToBookmark(page, 'Usage — Field Notes.md', 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('jump to a later heading bookmark opens the closed markdown note at the heading', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page, 'Field Notes.md', 'Field Notes');
    await placeReadingSelection(page, 'Reference details here.');
    await bookmarkCurrentHeading(page, 'Reference');
    // Close the note tab, then jump from the Bookmarks list: the jump itself opens the note.
    const closeButton = page.getByRole('button', { name: /Close Field Notes/ });
    await expect(closeButton).toBeVisible({ timeout: 30000 });
    await closeButton.click();
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toHaveCount(0, {
      timeout: 30000,
    });
    await jumpToBookmark(page, 'Reference — Field Notes.md', 'Reference');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('jump to a position bookmark in a later section of a markdown note', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page, 'Field Notes.md', 'Field Notes');
    await placeReadingSelection(page, 'Usage details here.');
    await pressShortcut(page, 'Control+Alt+J');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await placeReadingSelection(page, 'Intro paragraph');
    await jumpToBookmark(page, /\(position\)/, 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('jump to a heading bookmark while the markdown note is in edit mode', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page, 'Field Notes.md', 'Field Notes');
    await pressShortcut(page, 'Control+E');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toBeFocused();
    // Caret inside the Usage section, then bookmark its heading.
    await page.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea.markdown-editor');
      if (!area) throw new Error('Markdown editor not found');
      const offset = area.value.indexOf('Usage details here.');
      area.focus();
      area.setSelectionRange(offset, offset);
    });
    await bookmarkCurrentHeading(page, 'Usage');
    // Caret back to the top, then jump from the Bookmarks list: the
    // textarea selection must move to the heading text.
    await expect(editor).toBeFocused({ timeout: 30000 });
    await pressShortcut(page, 'Control+Home');
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Field Notes.md' });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.click();
    const headingStart = NOTE_CONTENT.indexOf('## Usage') + '## '.length;
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            // The active element is the bookmark button until the jump
            // lands, so a null textarea must read as "not there yet"
            // (a throw fails the poll at once instead of retrying).
            const area =
              document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
            return {
              tag: area?.tagName ?? '',
              label: area?.getAttribute('aria-label') ?? '',
              start: area?.selectionStart ?? -1,
              end: area?.selectionEnd ?? -1,
              selected: area ? area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0) : '',
            };
          }),
        { timeout: 10000 },
      )
      .toEqual({
        tag: 'TEXTAREA',
        label: 'Markdown source',
        start: headingStart,
        end: headingStart + 5,
        selected: 'Usage',
      });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a second jump after the first lands on the second bookmark', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page, 'Field Notes.md', 'Field Notes');
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await placeReadingSelection(page, 'Reference details here.');
    await bookmarkCurrentHeading(page, 'Reference');
    await placeReadingSelection(page, 'Intro paragraph');
    await jumpToBookmark(page, 'Usage — Field Notes.md', 'Usage');
    await jumpToBookmark(page, 'Reference — Field Notes.md', 'Reference');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('bookmarks list follows the current note: another note hides the first note bookmarks', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedMarkdownLibrary());
  try {
    await openNote(page, 'Field Notes.md', 'Field Notes');
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    // Open the other note: the Field Notes bookmark leaves the
    // Bookmarks list — only the open note's bookmarks are shown.
    await switchView(page, 'Control+2', async () =>
      page.getByRole('gridcell', { name: 'Other.md', exact: true }).count(),
    );
    await openGridEntry(page, 'Other.md');
    await expect(page.getByRole('heading', { name: 'Other note', level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole('button', { name: 'Usage — Field Notes.md', exact: true }),
    ).toHaveCount(0, { timeout: 30000 });
    // Switch back to Field Notes: its bookmark is listed again, and
    // jumping from it lands on the heading.
    await switchView(page, 'Control+2', async () =>
      page.getByRole('gridcell', { name: 'Field Notes.md', exact: true }).count(),
    );
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    await jumpToBookmark(page, 'Usage — Field Notes.md', 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('jump works after the app restarts with the bookmark saved', async () => {
  // Two app launches in one test need more than the default 90s on a slow machine.
  test.setTimeout(180000);
  const paths = seedMarkdownLibrary();
  const first = await launchSeededApp(paths);
  const pageErrors: string[] = first.pageErrors;
  await openNote(first.page, 'Field Notes.md', 'Field Notes');
  await placeReadingSelection(first.page, 'Usage details here.');
  await bookmarkCurrentHeading(first.page, 'Usage');
  await expect(statusLine(first.page)).toContainText('Bookmarked heading "Usage".', { timeout: 30000 });
  // Restart without deleting the seeded library: the bookmark must survive.
  await first.app.close();
  const second = await launchSeededApp(paths);
  try {
    second.page.on('pageerror', (error) => pageErrors.push(String(error)));
    // The relaunch reopens the last notebook directly ("Items in
    // Seeded"), so there is no notebook row to double-click: open the
    // note straight from the grid.
    await expect(second.page.getByText('Items in Seeded', { exact: true })).toBeVisible({ timeout: 30000 });
    await openGridEntry(second.page, 'Field Notes.md');
    await expect(second.page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    await jumpToBookmark(second.page, 'Usage — Field Notes.md', 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(second.app, paths);
  }
});

test('duplicate headings: jump lands on the second occurrence', async () => {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        {
          name: 'Edge.md',
          content: '# Edge\n\nIntro.\n\n## Setup\n\nFirst setup section.\n\n## Setup\n\nSecond setup section.\n',
        },
      ],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Second setup section.');
    await bookmarkCurrentHeading(page, 'Setup');
    await placeReadingSelection(page, 'Intro.');
    await jumpToBookmark(page, 'Setup — Edge.md', 'Setup');
    // And it must be the SECOND Setup: the selection must sit inside it.
    const secondSetup = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h2')].filter((h) => h.textContent === 'Setup');
      const anchor = window.getSelection()?.anchorNode;
      return { count: headings.length, landedOnSecond: headings[1] ? headings[1].contains(anchor) : false };
    });
    expect(secondSetup).toEqual({ count: 2, landedOnSecond: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('formatted heading: bold heading bookmark jumps', async () => {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        { name: 'Edge.md', content: '# Edge\n\nIntro.\n\n## **Usage** guide\n\nUsage details here.\n' },
      ],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage guide');
    await placeReadingSelection(page, 'Intro.');
    await jumpToBookmark(page, 'Usage guide — Edge.md', 'Usage guide');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('link heading: markdown-link heading bookmark jumps', async () => {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        {
          name: 'Edge.md',
          content: '# Edge\n\nIntro.\n\n## See [the guide](https://example.com)\n\nGuide details here.\n',
        },
      ],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Guide details here.');
    await bookmarkCurrentHeading(page, 'See the guide');
    await placeReadingSelection(page, 'Intro.');
    await jumpToBookmark(page, 'See the guide — Edge.md', 'See the guide');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('wiki-link heading: [[wiki]] heading bookmark jumps', async () => {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [{ name: 'Edge.md', content: '# Edge\n\nIntro.\n\n## [[Usage]]\n\nUsage details here.\n' }],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await placeReadingSelection(page, 'Intro.');
    await jumpToBookmark(page, 'Usage — Edge.md', 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('wiki-link heading created in edit mode: jump lands on the heading, not the top', async () => {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [{ name: 'Edge.md', content: '# Edge\n\nIntro.\n\n## [[Usage]]\n\nUsage details here.\n' }],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
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
    await pressShortcut(page, 'Control+Alt+H');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue('Usage');
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await pressShortcut(page, 'Control+E');
    await expect(statusLine(page)).toContainText('Mode switched to read-only.', { timeout: 30000 });
    await jumpToBookmark(page, 'Usage — Edge.md', 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('image heading: image plus text heading bookmark jumps', async () => {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        { name: 'Edge.md', content: '# Edge\n\nIntro.\n\n## ![logo](logo.png) Usage\n\nUsage details here.\n' },
      ],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await placeReadingSelection(page, 'Intro.');
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Edge.md' });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.click();
    // The rendered heading text is " Usage": the image has no text content.
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: ' Usage', selection: ' Usage' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('image-only heading: bookmark jumps to the heading, not the top', async () => {
  // An image-only heading has no text to select: the old landing check
  // required a text-node selection, so it rejected the focus landing
  // and the jump fell back to the top of the note.
  const logoPng = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
    0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
    0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        { name: 'Edge.md', content: '# Edge\n\nIntro.\n\n## ![logo](logo.png)\n\nDetails here.\n' },
        { name: 'logo.png', content: logoPng },
      ],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Details here.');
    await pressShortcut(page, 'Control+Alt+H');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    // An image-only heading suggests no name: the reader names it.
    await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue('');
    await nameDialog.getByLabel('Bookmark name').fill('Logo section');
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await placeReadingSelection(page, 'Intro.');
    const bookmarkButton = page.getByRole('button', { name: 'Logo section — Edge.md' });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.click();
    // The heading has no text, so there is nothing to select: focus
    // itself is the landing.
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: '', selection: '' });
    await expect(statusLine(page)).toContainText('Jumped to the bookmarked place.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('footnote heading: bookmark jumps to the heading, not the top', async () => {
  // The rendered heading reads `Usage[1]` while its source stores
  // `Usage[^1]`, so no text comparison matches it; the jump used to
  // fall back to the top of the note while announcing the jump.
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        {
          name: 'Edge.md',
          content: '# Edge\n\nIntro.\n\n## Usage[^1]\n\nDetails here.\n\n[^1]: A footnote.\n',
        },
      ],
    },
  ]);
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openNote(page, 'Edge.md', 'Edge');
    await placeReadingSelection(page, 'Details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await placeReadingSelection(page, 'Intro.');
    const bookmarkButton = page.getByRole('button', { name: 'Usage — Edge.md' });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.click();
    await expect
      .poll(() => readingJumpState(page), { timeout: 10000 })
      .toEqual({ tag: 'H2', text: 'Usage[1]', selection: 'Usage[1]' });
    await expect(statusLine(page)).toContainText('Jumped to Usage.', { timeout: 30000 });
    // Focus must stay on the heading afterwards, not drift back to the
    // top or the saved reading position.
    const start = Date.now();
    while (Date.now() - start < 2000) {
      expect(await readingJumpState(page)).toEqual({ tag: 'H2', text: 'Usage[1]', selection: 'Usage[1]' });
      await page.waitForTimeout(250);
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('jump to a later heading bookmark in an HTML note is not regressed', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp(seedHtmlLibrary());
  try {
    await openNote(page, 'Field Notes.html', 'Field Notes');
    await placeReadingSelection(page, 'Usage details here.');
    await bookmarkCurrentHeading(page, 'Usage');
    await placeReadingSelection(page, 'Intro paragraph');
    await jumpToBookmark(page, 'Usage — Field Notes.html', 'Usage');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
