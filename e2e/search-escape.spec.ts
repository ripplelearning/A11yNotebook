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
 * Global search Escape end-to-end pass (Tristen, 1.9.22 retest, item 6,
 * Nov 24, 2026): after performing a search, pressing Escape did nothing —
 * the text and the results stayed on screen. Escape must now clear the
 * search text and remove the results, from the search input and from a
 * result row, and must not disturb the command palette's own Escape.
 *
 * Each test launches the real app against a seeded library and drives the
 * real search box. Screen-reader announcements cannot be checked here;
 * the status line text is the visible half of the announcement, and
 * Tristen's manual retest remains the only check for what is spoken.
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

async function searchFor(page: Page, text: string): Promise<void> {
  const input = page.getByLabel('Global search');
  await input.fill(text);
  await expect(page.getByRole('button', { name: 'Note: Review note' })).toBeVisible();
  await expect(statusLine(page)).toContainText(/search results shown/);
}

async function expectSearchCleared(page: Page): Promise<void> {
  await expect(page.getByLabel('Global search')).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Search results' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Note: Review note' })).toHaveCount(0);
  await expect(statusLine(page)).toContainText('Search cleared.');
}

test('Escape from the search input clears the text and removes the results', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await searchFor(page, 'review');
    const input = page.getByLabel('Global search');
    await input.focus();
    await page.keyboard.press('Escape');
    await expectSearchCleared(page);
    await expect(input).toBeFocused();
  } finally {
    await closeApp(app, paths);
  }
});

test('Escape from a result row clears the search and returns focus to the search input', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await searchFor(page, 'review');
    const result = page.getByRole('button', { name: 'Note: Review note' });
    await result.focus();
    await page.keyboard.press('Escape');
    await expectSearchCleared(page);
    await expect(page.getByLabel('Global search')).toBeFocused();
  } finally {
    await closeApp(app, paths);
  }
});

test('Escape with no search active does nothing, and palette Escape still dismisses the palette', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    // No search active: Escape in the empty input is a harmless no-op.
    const input = page.getByLabel('Global search');
    await input.focus();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect(page.getByRole('list', { name: 'Search results' })).toHaveCount(0);

    // With results showing, the palette's own Escape still dismisses the
    // palette and leaves the search alone.
    await searchFor(page, 'review');
    for (let attempt = 0; attempt < 6; attempt++) {
      if ((await page.getByRole('dialog', { name: 'Command palette' }).count()) > 0) break;
      await pressShortcut(page, 'Control+Shift+P');
      await page.waitForTimeout(500);
    }
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(page.getByLabel('Global search')).toHaveValue('review');
    await expect(page.getByRole('button', { name: 'Note: Review note' })).toBeVisible();
  } finally {
    await closeApp(app, paths);
  }
});
