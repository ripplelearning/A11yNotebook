import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  closeApp,
  copyFileToClipboard,
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
 * Guided paste end-to-end pass: clipboard text, HTML, pictures, and
 * whole files pasted into a notebook go through the guided flow — the
 * note-or-attachment, format, and name questions for content, and the
 * copy-or-Alius plus file-name questions for whole files — instead of
 * landing silently. Clipboard content is written with the Async
 * Clipboard API in the renderer (the same API the app's editor paste
 * already relies on); whole files are put on the OS clipboard the way
 * Explorer or Finder does, through the main-process clipboard module.
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchPasteApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        { name: 'Seeded note.md', content: '# Seeded note\n' },
        { name: 'Page.html', content: '<h1>Page</h1><p>Some text.</p>' },
      ],
    },
    { name: 'Second', files: [] },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Seeded' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

/** Click the panel (not a row or an editor) so Ctrl+V reaches the panel paste handler. */
async function focusPanel(page: Page): Promise<void> {
  await page.getByText(/Items in /, { exact: false }).first().click();
}

/**
 * Clipboard writes for the paste scenarios go through the main-process
 * clipboard module: the app blocks every renderer permission request
 * (electron/main.ts), so the Async Clipboard API is denied in the
 * renderer and cannot stage the clipboard. Writing from the main
 * process is the same clipboard a user copy lands on.
 */
async function writeTextClipboard(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

async function writeHtmlClipboard(app: ElectronApplication, html: string, plain: string): Promise<void> {
  await app.evaluate(
    ({ clipboard, ClipboardItem }, { htmlValue, plainValue }) =>
      clipboard.write([new ClipboardItem({ 'text/html': htmlValue, 'text/plain': plainValue })]),
    { htmlValue: html, plainValue: plain },
  );
}

/** A 1x1 red PNG, for the picture-paste scenario. */
async function writeImageClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ clipboard, ClipboardItem }) => {
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  });
}

/**
 * What a browser puts on the clipboard for "Copy image": the picture
 * bytes plus HTML carrying the <img> tag (and its alt text, when the
 * source provides one) — and, for a figure, its caption.
 */
async function writeWebImageClipboard(app: ElectronApplication, html: string, plain?: string): Promise<void> {
  await app.evaluate(
    ({ clipboard, ClipboardItem }, { htmlValue, plainValue }) => {
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const types: Record<string, Blob> = {
        'image/png': new Blob([bytes], { type: 'image/png' }),
        'text/html': new Blob([htmlValue], { type: 'text/html' }),
      };
      if (plainValue !== undefined) types['text/plain'] = new Blob([plainValue], { type: 'text/plain' });
      return clipboard.write([new ClipboardItem(types)]);
    },
    { htmlValue: html, plainValue: plain },
  );
}

function pasteDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Paste into notebook' });
}

test('paste text as a markdown note, named from its first line', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeTextClipboard(app, 'Shopping list\n- milk\n- bread');
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Shopping list');
    await expect(dialog.getByLabel('Format')).toHaveValue('markdown');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(statusLine(page)).toContainText('Pasted Shopping list.md into Seeded.', { timeout: 30000 });
    await expect(page.getByText('milk', { exact: true })).toBeVisible();
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste HTML as a rich-text note, keeping its heading', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeHtmlClipboard(app, '<h1>Meeting notes</h1><p>Decisions from today.</p>', 'Meeting notes');
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Format')).toHaveValue('html');
    await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Meeting notes');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(statusLine(page)).toContainText('Pasted Meeting notes.html into Seeded.', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Meeting notes', level: 1 })).toBeVisible();
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste structured HTML as markdown, converting headings, lists, and tables', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeHtmlClipboard(
      app,
      '<h1>Guide</h1><ul><li>First step</li><li>Second step</li></ul>' +
        '<table><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>1</td></tr></table>',
      'Guide',
    );
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Format').selectOption('markdown');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(statusLine(page)).toContainText('Pasted Guide.md into Seeded.', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Guide', level: 1 })).toBeVisible();
    await expect(page.getByText('First step', { exact: true })).toBeVisible();
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste text as plain text', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeTextClipboard(app, 'Quick reminder\nCall back tomorrow.');
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Format').selectOption('txt');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(statusLine(page)).toContainText('Pasted Quick reminder.txt into Seeded.', { timeout: 30000 });
    await expect(page.getByText('Call back tomorrow.')).toBeVisible();
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a whole file as a copy, through the copy-or-Alius prompt', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page, paths } = launched;
    const fixtureDir = path.join(paths.baseDir, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'Report.txt');
    writeFileSync(fixturePath, 'Quarterly report contents.\n', 'utf8');
    await openNotebook(page, 'Seeded');
    await copyFileToClipboard(app, fixturePath);
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Make a copy/ })).toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Report.txt');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Report.txt' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Pasted Report.txt into Seeded.');
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a whole file as an Alius, keeping the original', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page, paths } = launched;
    const fixtureDir = path.join(paths.baseDir, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'Report.txt');
    writeFileSync(fixturePath, 'Quarterly report contents.\n', 'utf8');
    await openNotebook(page, 'Seeded');
    await copyFileToClipboard(app, fixturePath);
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Create an Alius/).click();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Report.txt.alius' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Imported Report.txt as an Alius. The original file was kept.');
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste with no notebook selected asks which notebook to use', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    // No notebook is opened: the Notebooks grid is showing, and no
    // notebook is selected.
    await page.getByRole('heading', { name: 'Notebooks' }).click();
    await writeTextClipboard(app, 'Loose thought\nWorth keeping.');
    await pressShortcut(page, 'Control+V');
    const picker = page.getByRole('dialog', { name: 'Choose a notebook' });
    await expect(picker).toBeVisible();
    await picker.getByLabel('Second', { exact: true }).click();
    await picker.getByRole('button', { name: 'Paste here' }).click();
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(statusLine(page)).toContainText('Pasted Loose thought.md into Second.', { timeout: 30000 });
    // The note landed in Second: open that notebook and find it there.
    await switchView(page, 'Control+2', async () =>
      page.getByRole('row', { name: /Second\s+notebook/ }).count(),
    );
    await openNotebook(page, 'Second');
    await expect(page.getByRole('gridcell', { name: 'Loose thought.md' })).toBeVisible({ timeout: 30000 });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a picture as an attachment, keeping its description', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeImageClipboard(app);
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Pasted image');
    await dialog.getByRole('textbox', { name: /Alt text/ }).fill('A red dot');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(page.getByRole('gridcell', { name: 'Pasted image.png' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Pasted Pasted image.png into Seeded.');
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste dialog opens with focus on the New Note radio, not the file name', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeTextClipboard(app, 'Shopping list\n- milk\n- bread');
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'New note' })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'File name' })).not.toBeFocused();
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a web-copied picture keeps the alt text the source provides', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page, paths } = launched;
    await openNotebook(page, 'Seeded');
    await writeWebImageClipboard(
      app,
      '<html><body><!--StartFragment-->' +
        '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/320px-Example.jpg" alt="A red dot on white">' +
        '<!--EndFragment--></body></html>',
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/320px-Example.jpg',
    );
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    // The alt text arrives pre-filled from the copied image: the user
    // keeps it by pasting, and the stored picture carries it.
    await expect(dialog.getByRole('textbox', { name: /Alt text/ })).toHaveValue('A red dot on white');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(page.getByRole('gridcell', { name: 'Pasted image.png' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Pasted Pasted image.png into Seeded.');
    await openGridEntry(page, 'Pasted image.png');
    const savedAlt = page.getByRole('textbox', { name: /Image description/ });
    await expect(savedAlt).toBeVisible({ timeout: 30000 });
    await expect(savedAlt).toHaveValue('A red dot on white');
    expect(readFileSync(path.join(paths.libraryDir, 'Seeded', 'Pasted image.png')).length).toBeGreaterThan(0);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a web-copied picture without alt text keeps its figure caption', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeWebImageClipboard(
      app,
      '<html><body><!--StartFragment-->' +
        '<figure><img src="https://example.com/dot.jpg">' +
        '<figcaption>A red dot, captioned</figcaption></figure>' +
        '<!--EndFragment--></body></html>',
    );
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /Alt text/ })).toHaveValue('A red dot, captioned');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(page.getByRole('gridcell', { name: 'Pasted image.png' })).toBeVisible({ timeout: 30000 });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a web-copied picture into an open HTML note inserts it inline', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchPasteApp();
    const { app, page, paths } = launched;
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Page.html');
    await expect(page.getByRole('heading', { name: 'Page', level: 1 })).toBeVisible({ timeout: 30000 });
    await pressShortcut(page, 'Control+E');
    await page.getByRole('button', { name: 'Rich text', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Rich text editor' });
    await expect(editor).toBeVisible({ timeout: 30000 });
    await editor.click();
    await writeWebImageClipboard(
      app,
      '<html><body><!--StartFragment-->' +
        '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/320px-Example.jpg" alt="A red dot on white">' +
        '<!--EndFragment--></body></html>',
    );
    await pressShortcut(page, 'Control+V');
    const inserted = editor.locator('img[alt="A red dot on white"]');
    await expect(inserted).toHaveCount(1, { timeout: 30000 });
    await expect(inserted).toHaveAttribute('src', /vault-file:\/\/attachment\/Seeded\/Pasted%20image\.png/);
    await pressShortcut(page, 'Control+S');
    await expect(statusLine(page)).toContainText('Saved Page.', { timeout: 30000 });
    // The picture survives the save: the note file holds the inline
    // image with its description, and the reading view shows it.
    const saved = readFileSync(path.join(paths.libraryDir, 'Seeded', 'Page.html'), 'utf8');
    expect(saved).toContain('alt="A red dot on white"');
    expect(saved).toContain('vault-file://attachment/Seeded/Pasted%20image.png');
    await pressShortcut(page, 'Control+E');
    await expect(statusLine(page)).toContainText('Mode switched to read-only.', { timeout: 30000 });
    await expect(page.getByRole('img', { name: 'A red dot on white' })).toBeVisible({ timeout: 30000 });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});
