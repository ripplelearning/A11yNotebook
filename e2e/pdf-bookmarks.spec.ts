import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
 * Page-anchored PDF bookmarks: setting with Ctrl+Alt+B (naming prompt
 * prefilled "Page N"), Ctrl+Alt+H announcing that heading bookmarks are
 * for notes, jumping to the next bookmark with Ctrl+Alt+J
 * (wrapping to the first) in Paginated and Continuous view, list scoping
 * to the open file, jumping into a closed PDF, deleting, and persistence
 * across a relaunch. A jump only passes when focus AND the DOM selection
 * land on the bookmarked spot: focus alone does not move a screen
 * reader's virtual cursor. Fixtures are generated with pdf-lib, so no
 * third-party file is involved.
 */

async function multiPagePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
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

const GUIDE_PAGES = [
  ['Alpha line one.', 'Alpha line two.'],
  ['Beta line one.', 'Beta line two.'],
  ['Gamma line one.', 'Gamma line two.'],
];

const NOTE_CONTENT =
  '# Field Notes\n\nIntro paragraph at the top of the note.\n\n## Setup\n\nSetup details here. Follow these steps first.\n';

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
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

async function seedLibraryWithPdfs(): Promise<SeedPaths> {
  const paths = seedLibrary([
    {
      name: 'Notes',
      files: [
        { name: 'Guide.pdf', content: await multiPagePdf(GUIDE_PAGES) },
        { name: 'Other.pdf', content: await multiPagePdf([['Other page one.']]) },
        { name: 'Field Notes.md', content: NOTE_CONTENT },
      ],
    },
  ]);
  return paths;
}

/** Seed a note bookmark in bookmarks.json, the way the app stores it. */
function seedNoteBookmark(paths: SeedPaths): void {
  mkdirSync(path.join(paths.libraryDir, '.a11ynotebook'), { recursive: true });
  writeFileSync(
    path.join(paths.libraryDir, '.a11ynotebook', 'bookmarks.json'),
    JSON.stringify(
      [
        {
          id: 'bm-note',
          path: 'Notes/Field Notes.md',
          title: 'Setup',
          created: new Date().toISOString(),
          anchor: { kind: 'heading', text: 'Setup', occurrence: 0 },
          name: 'Setup mark',
        },
      ],
      null,
      2,
    ),
    'utf8',
  );
}

async function openPdf(page: Page, fileName: string): Promise<void> {
  await openNotebook(page, 'Notes');
  await openGridEntry(page, fileName);
  await expect(page.getByRole('heading', { name: 'Page text' })).toBeVisible({ timeout: 30000 });
}

async function goToPage(page: Page, pageNumber: number): Promise<void> {
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('heading', { name: `Page ${pageNumber} of 3` })).toBeVisible({ timeout: 30000 });
}

/** Place a collapsed selection in the reader's accessible page text, the way a screen reader's virtual cursor leaves it. */
async function placePdfSelection(page: Page, text: string, offset = 1): Promise<void> {
  // The page heading updates before the page's semantic text renders,
  // so wait for a span carrying the wanted text: placing the caret in
  // the not-yet-rendered plain text would fall back to the top of the
  // page instead of the wanted spot.
  await page.waitForFunction(
    ({ wanted }) => {
      const section = document.querySelector('section[aria-label^="Accessible text for PDF page"]');
      if (!section) return false;
      return [...section.querySelectorAll('[data-start-offset]')].some((span) => span.textContent?.includes(wanted));
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
async function bookmarkWithShortcut(
  page: Page,
  shortcut: string,
  expectedDefault: string,
  name?: string,
): Promise<void> {
  await pressShortcut(page, shortcut);
  const dialog = page.getByRole('dialog', { name: 'Name bookmark' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Bookmark name')).toHaveValue(expectedDefault);
  if (name) await dialog.getByLabel('Bookmark name').fill(name);
  await dialog.getByRole('button', { name: 'Save bookmark' }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
}

async function jumpToBookmark(
  page: Page,
  buttonName: string | RegExp,
  expectedLine: string,
  expectedStatus: string,
): Promise<void> {
  const bookmarkButton = page.getByRole('button', { name: buttonName });
  await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
  await bookmarkButton.click();
  await expect
    .poll(() => readingJumpState(page), { timeout: 15000 })
    .toMatchObject({ tag: 'P', text: expect.stringContaining(expectedLine) });
  const state = await readingJumpState(page);
  expect(state.selection.length).toBeGreaterThan(0);
  expect(state.text).toContain(state.selection.trim());
  await expect(statusLine(page)).toContainText(expectedStatus, { timeout: 30000 });
}

/** Jump to the next bookmark with Ctrl+Alt+J and check the landing. */
async function jumpToNextBookmark(page: Page, expectedLine: string, expectedStatus: string): Promise<void> {
  await pressShortcut(page, 'Control+Alt+J');
  await expect
    .poll(() => readingJumpState(page), { timeout: 15000 })
    .toMatchObject({ tag: 'P', text: expect.stringContaining(expectedLine) });
  const state = await readingJumpState(page);
  expect(state.selection.length).toBeGreaterThan(0);
  expect(state.text).toContain(state.selection.trim());
  await expect(statusLine(page)).toContainText(expectedStatus, { timeout: 30000 });
}

test('PDF bookmarks set with Ctrl+Alt+B and jumped to with Ctrl+Alt+J in paginated view', async () => {
  test.setTimeout(180000);
  const paths = await seedLibraryWithPdfs();
  const { app, page } = await launchSeededApp(paths);
  try {
    await openPdf(page, 'Guide.pdf');
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
    await goToPage(page, 2);
    await placePdfSelection(page, 'Beta line one.');
    await bookmarkWithShortcut(page, 'Control+Alt+B', 'Page 2', 'Beta start');
    await expect(statusLine(page)).toContainText('Bookmarked "Beta start" on page 2.', { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Beta start (Page 2)' })).toBeVisible();
    await goToPage(page, 3);
    await bookmarkWithShortcut(page, 'Control+Alt+B', 'Page 3');
    await expect(statusLine(page)).toContainText('Bookmarked "Page 3" on page 3.', { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Page 3 (Page 3)' })).toBeVisible();
    // Jump back to page 2 from page 3: the reader turns the page and
    // lands focus and the selection on the bookmarked line.
    await jumpToBookmark(page, 'Beta start (Page 2)', 'Beta line one.', 'Jumped to Beta start.');
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible();
    // Ctrl+Alt+J jumps to the next bookmark after the current spot —
    // the Page 3 bookmark — and again wraps to the first.
    await jumpToNextBookmark(page, 'Gamma line one.', 'Jumped to Page 3.');
    await expect(page.getByRole('heading', { name: 'Page 3 of 3' })).toBeVisible();
    await jumpToNextBookmark(page, 'Beta line one.', 'Jumped to Beta start.');
    await expect(page.getByRole('heading', { name: 'Page 2 of 3' })).toBeVisible();
  } finally {
    await closeApp(app, paths);
  }
});

test('Ctrl+Alt+H in a PDF says heading bookmarks are for notes', async () => {
  const paths = await seedLibraryWithPdfs();
  const { app, page, pageErrors } = await launchSeededApp(paths);
  try {
    await openPdf(page, 'Guide.pdf');
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
    await placePdfSelection(page, 'Alpha line one.');
    // H must not set a page-and-spot bookmark in a PDF — that is B's
    // job — so it announces the heading command is for notes and opens
    // no naming prompt.
    await pressShortcut(page, 'Control+Alt+H');
    await expect(statusLine(page)).toContainText(
      'Heading bookmarks are for notes. Press Ctrl+Alt+B to bookmark this page and spot.',
      { timeout: 30000 },
    );
    await expect(page.getByRole('dialog', { name: 'Name bookmark' })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('PDF bookmarks jump with Ctrl+Alt+J in continuous view', async () => {
  test.setTimeout(180000);
  const paths = await seedLibraryWithPdfs();
  const { app, page } = await launchSeededApp(paths);
  try {
    await openPdf(page, 'Guide.pdf');
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
    await goToPage(page, 2);
    await placePdfSelection(page, 'Beta line two.');
    await bookmarkWithShortcut(page, 'Control+Alt+B', 'Page 2', 'Beta second');
    await expect(statusLine(page)).toContainText('Bookmarked "Beta second" on page 2.', { timeout: 30000 });
    await goToPage(page, 3);
    await placePdfSelection(page, 'Gamma line one.');
    await bookmarkWithShortcut(page, 'Control+Alt+B', 'Page 3', 'Gamma spot');
    await expect(statusLine(page)).toContainText('Bookmarked "Gamma spot" on page 3.', { timeout: 30000 });
    await page.getByRole('radio', { name: 'Continuous view' }).click();
    await expect(page.getByRole('radio', { name: 'Continuous view' })).toBeChecked();
    // Past the last bookmark on page 3: J wraps to the first.
    await placeContinuousSelection(page, 'Gamma line two.');
    await jumpToNextBookmark(page, 'Beta line two.', 'Jumped to Beta second.');
    // And from there J jumps forward to the Gamma bookmark.
    await jumpToNextBookmark(page, 'Gamma line one.', 'Jumped to Gamma spot.');
    // The list jump still works in continuous view too.
    await jumpToBookmark(page, 'Beta second (Page 2)', 'Beta line two.', 'Jumped to Beta second.');
  } finally {
    await closeApp(app, paths);
  }
});

test('PDF bookmark list scopes to the open file, jumps into a closed PDF, and deletes', async () => {
  test.setTimeout(180000);
  const paths = await seedLibraryWithPdfs();
  seedNoteBookmark(paths);
  const { app, page } = await launchSeededApp(paths);
  try {
    await openPdf(page, 'Guide.pdf');
    await expect(page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
    // With the PDF open, only its bookmarks show — not the note's.
    await bookmarkWithShortcut(page, 'Control+Alt+B', 'Page 1', 'Guide spot');
    await expect(page.getByRole('button', { name: 'Guide spot (Page 1)' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Setup mark — Field Notes.md' })).toHaveCount(0);
    // With the note open, only the note's bookmarks show.
    await pressShortcut(page, 'Control+2');
    await openNotebook(page, 'Notes');
    await openGridEntry(page, 'Field Notes.md');
    await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Setup mark — Field Notes.md' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Guide spot (Page 1)' })).toHaveCount(0);
    // With nothing open, every bookmark shows, and the PDF one names its file.
    await pressShortcut(page, 'Control+2');
    await expect(page.getByRole('button', { name: 'Guide spot (Page 1) — Guide.pdf' })).toBeVisible({
      timeout: 30000,
    });
    // Activating it opens the closed PDF at its bookmarked spot.
    await jumpToBookmark(page, 'Guide spot (Page 1) — Guide.pdf', 'Alpha line one.', 'Jumped to Guide spot.');
    // And the bookmark deletes like a note bookmark.
    const item = page.locator('li', { has: page.getByRole('button', { name: 'Guide spot (Page 1)' }) });
    await item.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: 'Guide spot (Page 1)' })).toHaveCount(0);
    await expect(statusLine(page)).toContainText('Bookmark removed.', { timeout: 30000 });
  } finally {
    await closeApp(app, paths);
  }
});

test('PDF bookmarks persist across a relaunch', async () => {
  test.setTimeout(180000);
  const paths = await seedLibraryWithPdfs();
  let launched = await launchSeededApp(paths);
  try {
    await openPdf(launched.page, 'Guide.pdf');
    await expect(launched.page.getByRole('heading', { name: 'Page 1 of 3' })).toBeVisible({ timeout: 30000 });
    await bookmarkWithShortcut(launched.page, 'Control+Alt+B', 'Page 1', 'Kept spot');
    await expect(statusLine(launched.page)).toContainText('Bookmarked "Kept spot" on page 1.', {
      timeout: 30000,
    });
    await launched.app.close();
    launched = await launchSeededApp(paths);
    await expect(launched.page.getByRole('button', { name: 'Kept spot (Page 1) — Guide.pdf' })).toBeVisible({
      timeout: 30000,
    });
    await jumpToBookmark(launched.page, 'Kept spot (Page 1) — Guide.pdf', 'Alpha line one.', 'Jumped to Kept spot.');
  } finally {
    await launched.app.close();
    rmSync(paths.baseDir, { recursive: true, force: true });
  }
});
