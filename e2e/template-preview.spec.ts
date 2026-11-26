import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { closeApp, dismissTutorial, launchApp, seedLibrary, waitForApp } from './helpers';

/**
 * Template reading-view preview: a template note shows the six known
 * placeholders filled in with the template's own context (its title,
 * its notebook, and the current date/time), while unknown {{Name}}
 * markers still render as fillable textboxes and the stored template
 * keeps the raw markers. A regular note keeps known placeholders
 * literal. {{cursor}} previews as nothing.
 */

const PREVIEW_CONTENT =
  '# {{title}}\n\nNotebook: {{notebook}}\nDate: {{date}}\nClient: {{Client Name}}\n\n{{cursor}}\n';

const REGULAR_CONTENT = '# {{title}}\n\nDate: {{date}}\n';

function seed() {
  return seedLibrary([
    { name: 'Templates', files: [{ name: 'Preview.md', content: PREVIEW_CONTENT }] },
    { name: 'Notes', files: [{ name: 'Regular.md', content: REGULAR_CONTENT }] },
  ]);
}

async function openNotebook(page: Page, name: string) {
  await expect(page.getByRole('gridcell', { name })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await page.getByRole('row', { name: new RegExp(`${name}\\s+notebook`) }).dblclick();
}

async function openNote(page: Page, fileName: string) {
  const noteCell = page.getByRole('gridcell', { name: fileName });
  await expect(noteCell).toBeVisible({ timeout: 30000 });
  await noteCell.dblclick();
}

function expectedDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test('a template note previews known placeholders with its own context', async () => {
  let app: ElectronApplication | null = null;
  const paths = seed();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);

    await openNotebook(page, 'Templates');
    await openNote(page, 'Preview.md');
    const body = page.locator('.document-body');
    await expect(body).toBeVisible();
    // Title previews from the template's file name, notebook from its folder.
    await expect(body.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(body).toContainText('Notebook: Templates');
    await expect(body).toContainText(`Date: ${expectedDate()}`);
    // No literal markers remain in the reading view; the cursor marker renders nothing.
    await expect(body).not.toContainText('{{');
    // Unknown names still render as fillable textboxes.
    await expect(page.getByRole('textbox', { name: 'Client Name' })).toBeVisible();

    // The stored template is untouched: the preview is display-only.
    expect(readFileSync(path.join(paths.libraryDir, 'Templates', 'Preview.md'), 'utf8')).toBe(PREVIEW_CONTENT);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a regular note keeps known placeholders literal', async () => {
  let app: ElectronApplication | null = null;
  const paths = seed();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);

    await openNotebook(page, 'Notes');
    await openNote(page, 'Regular.md');
    const body = page.locator('.document-body');
    await expect(body).toBeVisible();
    await expect(body).toContainText('{{title}}');
    await expect(body).toContainText('{{date}}');

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
