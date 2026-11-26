import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openNotebook,
  seedLibrary,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Regression test for the 1.9.22 retest item: from the Notes and Files
 * grid, with a note, link, or file selected, the context menu had no
 * Create Task option at all — the new-task command was general-only.
 * The menu item now opens the New task dialog with the selected item
 * linked to the task: a note becomes the associated note, and a file or
 * link is attached to the created task as its link.
 *
 * A `.url` file on disk is picked up by the library scan as a link entry
 * (kind 'link'), and a `.csv` as an attachment, so seeding them is
 * enough — no provenance record needed for either.
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
}

async function launchGridApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([
    {
      name: 'Archive',
      files: [
        { name: 'Guide.md', content: '# Guide\n\nArchive guide.\n' },
        { name: 'Report.csv', content: 'a,b\n1,2\n' },
        { name: 'Example.url', content: '[InternetShortcut]\nURL=https://example.com\n' },
      ],
    },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
  await openNotebook(page, 'Archive');
  return { app, page, paths };
}

async function openCreateTask(page: Page, name: string) {
  const cell = page.getByRole('gridcell', { name, exact: true });
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.click();
  await expect(cell).toBeFocused();
  await cell.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  expect(await menu.getAttribute('aria-label')).toBe(`Actions for ${name}`);
  await page.getByRole('menuitem', { name: 'Create task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/**
 * Seed a library the way a cloud sync leaves it: the note's file was
 * replaced by sync, so its origin record no longer matches and the
 * note carries no provenance, while a template created in the app
 * still has one. Before the fix the New task dialog listed only the
 * template; the real note was missing from the dropdown entirely.
 */
function seedLibraryWithSyncReplacedNote(): SeedPaths {
  const paths = seedLibrary([
    {
      name: 'Archive',
      files: [{ name: 'Guide.md', content: '# Guide\n\nArchive guide.\n' }],
    },
  ]);
  const templatesDir = path.join(paths.libraryDir, 'Templates');
  mkdirSync(templatesDir, { recursive: true });
  const templatePath = path.join(templatesDir, 'Daily.md');
  writeFileSync(templatePath, '# Daily\n\n{{Name}}\n');
  const stat = statSync(templatePath);
  const identity = createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`).digest('hex');
  writeFileSync(
    path.join(paths.libraryDir, '.a11ynotebook', 'provenance.json'),
    JSON.stringify({ version: 1, records: { [identity]: 'created' } }, null, 2),
    'utf8',
  );
  return paths;
}

test('the context menu on a note offers Create task with the note as the associated note', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const dialog = await openCreateTask(page, 'Guide.md');
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Guide.md', { timeout: 10000 });
    await dialog.getByLabel('Task description').fill('Review the guide');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    // Creating the task lands on the Tasks view, where the new task
    // carries its auto-link to the note it lives in.
    await expect(page.getByRole('checkbox', { name: 'Review the guide' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Open note: Archive/Guide.md' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('the context menu on a file offers Create task and links the created task to the file', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const dialog = await openCreateTask(page, 'Report.csv');
    // The task still lives in a note; the file becomes its link, so the
    // dropdown shows the file and names the note holding the task.
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Report.csv', { timeout: 10000 });
    await expect(
      dialog.getByText('Task will be saved in Archive/Guide.md and linked to Archive/Report.csv.'),
    ).toBeVisible({ timeout: 10000 });
    await dialog.getByLabel('Task description').fill('Check the report');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    await expect(page.getByRole('checkbox', { name: 'Check the report' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Open file: Archive/Report.csv' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('the context menu on a link offers Create task and links the created task to the link', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const dialog = await openCreateTask(page, 'Example.url');
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Example.url', { timeout: 10000 });
    await expect(
      dialog.getByText('Task will be saved in Archive/Guide.md and linked to Archive/Example.url.'),
    ).toBeVisible({ timeout: 10000 });
    await dialog.getByLabel('Task description').fill('Visit the example');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    await expect(page.getByRole('checkbox', { name: 'Visit the example' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Open file: Archive/Example.url' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('the dropdown lists a note whose origin record was lost to sync, and never lists templates', async () => {
  const paths = seedLibraryWithSyncReplacedNote();
  const { app, page } = await launchApp(paths.userDataDir);
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
    await openNotebook(page, 'Archive');
    const dialog = await openCreateTask(page, 'Guide.md');
    // The note holds the task even though sync replaced its file and
    // its origin record no longer matches. Options in a closed native
    // select have no visible box, so count the option instead of
    // asking whether it is visible; the value check below confirms
    // the note is the selected association.
    await expect(dialog.getByRole('option', { name: 'Archive/Guide.md' })).toHaveCount(1, { timeout: 10000 });
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Guide.md', { timeout: 10000 });
    // Templates are not notes: none of them may appear as an option.
    await expect(dialog.getByRole('option', { name: 'Templates/Daily.md' })).toHaveCount(0);
    await dialog.getByLabel('Task description').fill('Review the guide');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    await expect(page.getByRole('checkbox', { name: 'Review the guide' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Open note: Archive/Guide.md' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('choosing a file in the Associate with dropdown links the task to it', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const dialog = await openCreateTask(page, 'Guide.md');
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Guide.md', { timeout: 10000 });
    await dialog.getByLabel('Associate with').selectOption('Archive/Report.csv');
    await expect(
      dialog.getByText('Task will be saved in Archive/Guide.md and linked to Archive/Report.csv.'),
    ).toBeVisible({ timeout: 5000 });
    await dialog.getByLabel('Task description').fill('Check the report from the dropdown');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    await expect(page.getByRole('checkbox', { name: 'Check the report from the dropdown' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Open file: Archive/Report.csv' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('choosing a notebook in the Associate with dropdown links the task to it', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const dialog = await openCreateTask(page, 'Guide.md');
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Guide.md', { timeout: 10000 });
    await dialog.getByLabel('Associate with').selectOption('Archive');
    await expect(
      dialog.getByText('Task will be saved in Archive/Guide.md and linked to Archive.'),
    ).toBeVisible({ timeout: 5000 });
    await dialog.getByLabel('Task description').fill('Review the whole notebook');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    await expect(page.getByRole('checkbox', { name: 'Review the whole notebook' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Open notebook: Archive' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await closeApp(app, paths);
  }
});
