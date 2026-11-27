import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  pressShortcut,
  runPaletteCommand,
  seedLibrary,
  statusLine,
  switchView,
  waitForApp,
} from './helpers';

/**
 * Spreadsheet as a new note type: the New note dialog offers Spreadsheet
 * (.xlsx); creating one makes a blank .xlsx in the selected notebook,
 * opens it in the spreadsheet view, lists it in the grid as Type "Excel
 * spreadsheet", and round-trips an edit through save, close, and reopen.
 *
 * The dialog has no notebook picker — like every other new note, the
 * spreadsheet lands in the notebook selected when the dialog opens.
 */

async function createSpreadsheet(page: Page, name: string): Promise<void> {
  await runPaletteCommand(page, 'New note');
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await expect(dialog).toBeVisible();
  const options = await dialog.getByLabel('Note format').locator('option').allTextContents();
  expect(options).toEqual(['Markdown (.md)', 'HTML (.html)', 'Plain text (.txt)', 'Spreadsheet (.xlsx)']);
  await dialog.getByLabel('New Note Name').fill(name);
  await dialog.getByLabel('Note format').selectOption('spreadsheet');
  await dialog.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(statusLine(page)).toContainText('Spreadsheet created.', { timeout: 30000 });
  await expect(page.getByRole('table', { name: 'Sheet1 — 0 rows' })).toBeVisible({ timeout: 30000 });
}

test('a spreadsheet created from the dialog opens blank and shows Type Excel spreadsheet', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([{ name: 'Research', files: [{ name: 'Alpha.md', content: '# Alpha\n' }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await dismissTutorial(page);
    await expect(page.getByRole('gridcell', { name: 'Research' })).toBeVisible({ timeout: 30000 });

    await openNotebook(page, 'Research');
    await createSpreadsheet(page, 'Budget');

    // Back to the Notes and Files grid: the new file lists as Type
    // "Excel spreadsheet" next to its name.
    await switchView(page, 'Control+3', async () => page.getByRole('gridcell', { name: 'Budget.xlsx' }).count());
    const row = page.getByRole('row', { name: /Budget\.xlsx/ });
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.getByRole('gridcell').nth(1)).toHaveText('Excel spreadsheet');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a created spreadsheet round-trips an edit through save, close, and reopen', async () => {
  // Two app launches in one test need more than the default 90s on a
  // cold runner: each launch waits out the first Vite compile.
  test.setTimeout(240000);
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([{ name: 'Research', files: [{ name: 'Alpha.md', content: '# Alpha\n' }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    let page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await dismissTutorial(page);
    await expect(page.getByRole('gridcell', { name: 'Research' })).toBeVisible({ timeout: 30000 });

    await openNotebook(page, 'Research');
    await createSpreadsheet(page, 'Budget');

    // A blank sheet has no rows until one is added; then the first cell
    // takes the edit, and Ctrl+S saves it back into the new file.
    await page.getByRole('button', { name: 'Add row' }).click();
    const cell = page.getByLabel('Row 1, column A, empty');
    await expect(cell).toBeVisible({ timeout: 30000 });
    await cell.fill('42');
    // Filling renames the cell's accessible name to its new value, so
    // move focus with the keyboard instead of re-resolving the old name:
    // leaving the cell commits the edit.
    await page.keyboard.press('Tab');
    await pressShortcut(page, 'Control+S');
    await expect(statusLine(page)).toContainText('Saved Budget.xlsx.', { timeout: 30000 });

    // Close and relaunch against the same library. The new process has
    // no memory of the edit: if the value is still there, the file
    // round-tripped through save and reopen. Tab restore is unreliable
    // across relaunches, so reopen the spreadsheet from the Notes and
    // Files grid either way — that reopen is the round-trip to prove.
    await app.close();
    app = null;
    const relaunched = await launchApp(paths.userDataDir);
    app = relaunched.app;
    page = relaunched.page;
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await dismissTutorial(page);
    await switchView(page, 'Control+3', async () => page.getByRole('gridcell', { name: 'Budget.xlsx' }).count());
    await openGridEntry(page, 'Budget.xlsx');
    await expect(page.getByLabel('Row 1, column A, 42')).toBeVisible({ timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
