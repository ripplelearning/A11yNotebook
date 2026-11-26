import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openNotebook,
  pressShortcut,
  seedLibrary,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Regression test for the 1.9.25 retest item: opening the New Task
 * dialog moved keyboard focus straight to the Task Description
 * textbox, so a screen reader user had to Shift+Tab back to reach
 * the Associate with dropdown first. Focus must start in the
 * Associate with combo box instead.
 */

async function launchTasksApp(): Promise<{ app: ElectronApplication; page: Page; paths: SeedPaths }> {
  const paths = seedLibrary([
    {
      name: 'Archive',
      files: [{ name: 'Guide.md', content: '# Guide\n\nArchive guide.\n' }],
    },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
  await openNotebook(page, 'Archive');
  await switchView(page, 'Control+4', async () => page.getByText(/tasks shown\./).count());
  return { app, page, paths };
}

test('opening the New task dialog with Ctrl+N puts focus in the Associate with combo box', async () => {
  const { app, page, paths } = await launchTasksApp();
  try {
    await pressShortcut(page, 'Control+N');
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // No note is open, so nothing is preselected — but the dropdown
    // must be populated before asserting where focus landed.
    const associate = dialog.getByLabel('Associate with');
    await expect(associate.locator('option[value="Archive/Guide.md"]')).toHaveCount(1, { timeout: 10000 });
    await expect(associate).toBeFocused();
    await expect(dialog.getByLabel('Task description')).not.toBeFocused();
  } finally {
    await closeApp(app, paths);
  }
});

test('opening the New task dialog from the grid context menu puts focus in the Associate with combo box', async () => {
  const { app, page, paths } = await launchTasksApp();
  try {
    await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
    await openNotebook(page, 'Archive');
    const cell = page.getByRole('gridcell', { name: 'Guide.md', exact: true });
    await expect(cell).toBeVisible({ timeout: 30000 });
    await cell.click();
    await expect(cell).toBeFocused();
    await cell.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: 'Create task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Guide.md', { timeout: 10000 });
    await expect(dialog.getByLabel('Associate with')).toBeFocused();
    await expect(dialog.getByLabel('Task description')).not.toBeFocused();
  } finally {
    await closeApp(app, paths);
  }
});
