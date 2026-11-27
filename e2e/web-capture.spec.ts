import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
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
} from './helpers';

/**
 * Capture Webpage formats: the dialog offers Markdown Note, HTML Note,
 * and Webpage File; a Webpage File lands in the picked notebook as a
 * file of Type "Webpage"; the Notes and Files grid sorts by Type with
 * the same header interaction as sorting by Name; and a captured
 * webpage opens read-only in the reader.
 *
 * A live capture is not exercised here: it fetches a public HTTPS page,
 * which the test environment cannot rely on. The main-process handler
 * for the Webpage File format is covered in
 * src/test/vault-ipc-extensions.test.ts; this spec covers the dialog,
 * the grid, and the read-only open with a seeded webpage file.
 */

async function gridNames(page: Page): Promise<string[]> {
  const grid = page.getByRole('grid', { name: 'Notes and files' });
  const rows = grid.getByRole('row');
  const count = await rows.count();
  const names: string[] = [];
  for (let index = 1; index < count; index++) {
    names.push(((await rows.nth(index).getByRole('gridcell').first().textContent()) ?? '').trim());
  }
  return names;
}

test('capture dialog lists Markdown Note, HTML Note, and Webpage File', async () => {
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

    // The capture command refuses while the library is still opening,
    // so wait until the seeded notebook is listed before firing the
    // shortcut: on a slow Windows runner the shortcut can otherwise
    // land before the vault is ready, the command refuses, and the
    // dialog never opens.
    await expect(page.getByRole('gridcell', { name: 'Research' })).toBeVisible({ timeout: 30000 });

    await pressShortcut(page, 'Control+Shift+W');
    const dialog = page.getByRole('dialog', { name: 'Capture web page' });
    await expect(dialog).toBeVisible();
    const options = await dialog.getByLabel('Output format').locator('option').allTextContents();
    expect(options).toEqual(['Markdown Note', 'HTML Note', 'Webpage File']);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a webpage file shows Type Webpage, sorts by Type, and opens read-only', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([
    {
      name: 'Research',
      files: [
        { name: 'Alpha.md', content: '# Alpha\n\nAlpha note.\n' },
        { name: 'Data.csv', content: 'a,b\n1,2\n' },
        { name: 'Seeded.webpage.html', content: '<h1>Seeded page</h1><p>Captured text.</p>' },
      ],
    },
  ]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await dismissTutorial(page);

    await openNotebook(page, 'Research');
    const grid = page.getByRole('grid', { name: 'Notes and files' });
    await expect(grid.getByRole('gridcell', { name: 'Webpage', exact: true })).toBeVisible();
    await expect(grid.getByRole('gridcell', { name: 'note', exact: true })).toBeVisible();
    await expect(grid.getByRole('gridcell', { name: 'CSV', exact: true })).toBeVisible();

    // Default sort is by Name.
    expect(await gridNames(page)).toEqual(['Alpha.md', 'Data.csv', 'Seeded.webpage.html']);
    const typeHeader = grid.getByRole('button', { name: 'Type' });
    await typeHeader.click();
    await expect(grid.getByRole('columnheader', { name: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
    expect(await gridNames(page)).toEqual(['Data.csv', 'Alpha.md', 'Seeded.webpage.html']);
    await typeHeader.click();
    await expect(grid.getByRole('columnheader', { name: 'Type' })).toHaveAttribute('aria-sort', 'descending');
    expect(await gridNames(page)).toEqual(['Seeded.webpage.html', 'Alpha.md', 'Data.csv']);
    // Keyboard: Enter on the focused Type header sorts again.
    await grid.getByRole('columnheader', { name: 'Type' }).focus();
    await page.keyboard.press('Enter');
    await expect(grid.getByRole('columnheader', { name: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
    expect(await gridNames(page)).toEqual(['Data.csv', 'Alpha.md', 'Seeded.webpage.html']);

    // A webpage file opens in the reader with its content, and the edit
    // toggle refuses it: it is a file, not a note.
    await openGridEntry(page, 'Seeded.webpage.html');
    await expect(page.getByRole('heading', { name: 'Seeded page' })).toBeVisible();
    await expect(page.getByText('Captured text.')).toBeVisible();
    await pressShortcut(page, 'Control+E');
    await expect(statusLine(page)).toContainText('always opens read-only');
    await expect(page.getByRole('heading', { name: 'Seeded page' })).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
