import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
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
 * Regression test for the 1.9.21 retest item: the context menu for a saved
 * web link in the Notes and Files grid had no Create Reminder option,
 * while notes and files did. The menu item now opens the Create reminder
 * dialog with the link pre-selected, the same way a note or file is.
 *
 * A `.url` file on disk is picked up by the library scan as a link entry
 * (kind 'link'), so seeding one is enough — no provenance record needed.
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
        { name: 'Example.url', content: '[InternetShortcut]\nURL=https://example.com\n' },
      ],
    },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
  await openNotebook(page, 'Archive');
  const cell = page.getByRole('gridcell', { name: 'Example.url', exact: true });
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.click();
  await expect(cell).toBeFocused();
  return { app, page, paths };
}

test('the context menu on a link offers Create reminder with the link linked', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const cell = page.getByRole('gridcell', { name: 'Example.url', exact: true });

    await cell.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    expect(await menu.getAttribute('aria-label')).toBe('Actions for Example.url');
    await page.getByRole('menuitem', { name: 'Create reminder' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create reminder' });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByLabel('Link to')).toHaveValue('file');
    await expect(dialog.getByLabel('File')).toHaveValue('Archive/Example.url');

    await dialog.getByLabel('Reminder title').fill('Check example link');
    await dialog.getByRole('button', { name: 'Create reminder' }).click();

    // Creating the reminder lands on the Reminders view, where the new
    // reminder lists under today's agenda.
    await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Check example link', exact: true })).toBeVisible({
      timeout: 5000,
    });
  } finally {
    await closeApp(app, paths);
  }
});
