import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
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
 * Insert link end-to-end pass: the rich-text toolbar asks for the link in
 * the app's own dialog (the native prompt it used to ask with does not
 * work in Electron, so the button silently did nothing), and the link
 * lands in the note — as Markdown link syntax for Markdown notes, as an
 * anchor for HTML notes — with the selected text as its label.
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchLinkApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [
        { name: 'Seeded note.md', content: '# Seeded note\n\nVisit the guide\n' },
        { name: 'Page.html', content: '<h1>Page</h1><p>Some text.</p>' },
      ],
    },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Seeded' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

async function openRichTextEditor(page: Page, entry: string): Promise<void> {
  await openNotebook(page, 'Seeded');
  await openGridEntry(page, entry);
  await pressShortcut(page, 'Control+E');
  await page.getByRole('button', { name: 'Rich text', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Rich text editor' });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click();
}

/** Select a character range of the first paragraph's text in the rich-text editor. */
async function selectInEditor(page: Page, start: number, end: number): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const editor = document.querySelector('.rich-text-editor');
      const text = editor?.querySelector('p')?.firstChild;
      if (!editor || !text) throw new Error('Rich-text editor paragraph not found.');
      const range = document.createRange();
      range.setStart(text, from);
      range.setEnd(text, to);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { from: start, to: end },
  );
}

async function insertLink(page: Page, address: string, text?: string): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'Rich text formatting' })
    .getByRole('button', { name: 'Insert link' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Insert link' });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  if (text !== undefined) await dialog.getByLabel('Link text').fill(text);
  await dialog.getByLabel('Link address').fill(address);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
}

test('insert a link into a Markdown note with the toolbar, keeping the selected text', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchLinkApp();
    const { page, paths } = launched;
    await openRichTextEditor(page, 'Seeded note.md');
    await selectInEditor(page, 6, 15);
    await page
      .getByRole('toolbar', { name: 'Rich text formatting' })
      .getByRole('button', { name: 'Insert link' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Insert link' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByLabel('Link text')).toHaveValue('the guide');
    await dialog.getByLabel('Link address').fill('https://example.com');
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
    // The inserted link is written back as Markdown link syntax.
    await page.getByRole('button', { name: 'Plain source', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(source).toHaveValue(/# Seeded note\n\nVisit \[the guide\]\(https:\/\/example\.com\/\)/, {
      timeout: 30000,
    });
    await pressShortcut(page, 'Control+S');
    await expect(statusLine(page)).toContainText('Saved Seeded note.', { timeout: 30000 });
    expect(readFileSync(path.join(paths.libraryDir, 'Seeded', 'Seeded note.md'), 'utf8')).toContain(
      '[the guide](https://example.com/)',
    );
    await pressShortcut(page, 'Control+E');
    await expect(statusLine(page)).toContainText('Mode switched to read-only.', { timeout: 30000 });
    const link = page.getByRole('link', { name: 'the guide' });
    await expect(link).toBeVisible({ timeout: 30000 });
    await expect(link).toHaveAttribute('href', 'https://example.com/');
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('insert a link with no selection uses the address as the link text', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchLinkApp();
    const { page } = launched;
    await openRichTextEditor(page, 'Seeded note.md');
    await selectInEditor(page, 15, 15);
    await insertLink(page, 'https://example.com');
    await page.getByRole('button', { name: 'Plain source', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    // The converter escapes the dots in the URL used as link text; the
    // rendered link is identical.
    await expect(source).toHaveValue(/\[https:\/\/example\\\.com\/\]\(https:\/\/example\.com\/\)/, {
      timeout: 30000,
    });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('an invalid link address is refused and inserts nothing', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchLinkApp();
    const { page } = launched;
    await openRichTextEditor(page, 'Seeded note.md');
    await selectInEditor(page, 6, 15);
    await page
      .getByRole('toolbar', { name: 'Rich text formatting' })
      .getByRole('button', { name: 'Insert link' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Insert link' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByLabel('Link address').fill('javascript:alert(1)');
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30000 });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Plain source', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(source).toHaveValue('# Seeded note\n\nVisit the guide\n', { timeout: 30000 });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('insert a link into an HTML note with the toolbar', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchLinkApp();
    const { page, paths } = launched;
    await openRichTextEditor(page, 'Page.html');
    await selectInEditor(page, 0, 9);
    await insertLink(page, 'https://example.com', 'Some text');
    await pressShortcut(page, 'Control+S');
    await expect(statusLine(page)).toContainText('Saved Page.', { timeout: 30000 });
    expect(readFileSync(path.join(paths.libraryDir, 'Seeded', 'Page.html'), 'utf8')).toContain(
      '<a href="https://example.com/">Some text</a>',
    );
    await pressShortcut(page, 'Control+E');
    await expect(statusLine(page)).toContainText('Mode switched to read-only.', { timeout: 30000 });
    await expect(page.getByRole('link', { name: 'Some text' })).toBeVisible({ timeout: 30000 });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('Control+K opens the Insert link dialog in rich-text mode', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchLinkApp();
    const { page } = launched;
    await openRichTextEditor(page, 'Seeded note.md');
    await pressShortcut(page, 'Control+K');
    await expect(page.getByRole('dialog', { name: 'Insert link' })).toBeVisible({ timeout: 30000 });
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});
