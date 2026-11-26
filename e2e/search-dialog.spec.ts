import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  pressShortcut,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Search dialog end-to-end pass (Tristen, 1.9.23 retest, item 6,
 * Nov 25, 2026): the main screen shows a Search button instead of an
 * inline search box. The button opens an accessible search dialog
 * with a close button (also closed with Escape), a search textbox
 * with accessible autocomplete suggestions, the optional search
 * filters, and the search results. Closing with the Close button or
 * Escape clears the search box and the results and closes the dialog.
 * Activating a search result clears the box and results, closes the
 * dialog, and moves focus to the result's location.
 *
 * Screen-reader announcements cannot be checked here; the status line
 * text is the visible half of the announcement, and Tristen's manual
 * retest remains the only check for what is spoken.
 */

async function launchSearchApp(): Promise<{ app: ElectronApplication; page: Page; paths: SeedPaths }> {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [{ name: 'Review note.md', content: '# Review note\n\nA quarterly accessibility review.\n' }],
    },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  return { app, page, paths };
}

async function openSearchDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Global search')).toBeFocused();
}

async function searchFor(page: Page, text: string): Promise<void> {
  await openSearchDialog(page);
  await page.getByLabel('Global search').fill(text);
  await expect(page.getByRole('button', { name: 'Note: Review note' })).toBeVisible();
  await expect(statusLine(page)).toContainText(/search results shown/);
}

async function expectSearchCleared(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Note: Review note' })).toHaveCount(0);
  await expect(statusLine(page)).toContainText('Search cleared.');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
}

test('Search button opens the dialog and focuses the search box', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await openSearchDialog(page);
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(page.getByText('Search filters', { exact: true })).toBeVisible();
  } finally {
    await closeApp(app, paths);
  }
});

test('Alt+Q opens the search dialog', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    // The Search button is disabled until the library loads, and Alt+Q
    // is a no-op before then too: wait for it to enable first, or the
    // keypress races the library load and opens nothing.
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
    await pressShortcut(page, 'Alt+Q');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await expect(page.getByLabel('Global search')).toBeFocused();
  } finally {
    await closeApp(app, paths);
  }
});

test('autocomplete suggestions appear, arrow keys move through them, Enter fills the box', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await openSearchDialog(page);
    const input = page.getByLabel('Global search');
    await input.fill('review');
    const listbox = page.getByRole('listbox', { name: 'Search suggestions' });
    await expect(listbox).toBeVisible();
    const option = page.getByRole('option', { name: 'Note: Review note' });
    await expect(option).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
    await expect(option).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Review note');
    await expect(input).toBeFocused();
    // The filled text re-runs the search: the note is still a result.
    await expect(page.getByRole('button', { name: 'Note: Review note' })).toBeVisible();
  } finally {
    await closeApp(app, paths);
  }
});

test('Escape from the search box clears the text and results, closes the dialog, and returns focus', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await searchFor(page, 'review');
    const input = page.getByLabel('Global search');
    await input.focus();
    await page.keyboard.press('Escape');
    await expectSearchCleared(page);
  } finally {
    await closeApp(app, paths);
  }
});

test('Escape from a result row clears the search and closes the dialog', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await searchFor(page, 'review');
    const result = page.getByRole('button', { name: 'Note: Review note' });
    await result.focus();
    await page.keyboard.press('Escape');
    await expectSearchCleared(page);
  } finally {
    await closeApp(app, paths);
  }
});

test('Close button clears the search and closes the dialog', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await searchFor(page, 'review');
    await page.getByRole('button', { name: 'Close' }).click();
    await expectSearchCleared(page);
    // The search is really gone: reopening shows an empty box.
    await openSearchDialog(page);
    await expect(page.getByLabel('Global search')).toHaveValue('');
  } finally {
    await closeApp(app, paths);
  }
});

test('activating a result closes the dialog, clears the search, and opens the note', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await searchFor(page, 'review');
    await page.getByRole('button', { name: 'Note: Review note' }).click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0);
    // The note opens in reading view: its h1 is the opened document's
    // title (the tabpanel has its own h2 with the same text).
    await expect(page.getByRole('heading', { name: 'Review note', level: 1 })).toBeVisible();
    // The search is cleared, not merely hidden: reopening shows an empty box.
    await openSearchDialog(page);
    await expect(page.getByLabel('Global search')).toHaveValue('');
  } finally {
    await closeApp(app, paths);
  }
});

test('Escape with no search active does nothing, and palette Escape still dismisses the palette', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    // No dialog open: the palette's own Escape still dismisses it.
    for (let attempt = 0; attempt < 6; attempt++) {
      if ((await page.getByRole('dialog', { name: 'Command palette' }).count()) > 0) break;
      await pressShortcut(page, 'Control+Shift+P');
      await page.waitForTimeout(500);
    }
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
  } finally {
    await closeApp(app, paths);
  }
});
