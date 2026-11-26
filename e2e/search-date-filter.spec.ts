import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Regression reproduction (1.9.23 retest, item 6): "The search results
 * are not being displayed anymore."
 *
 * PR #252 changed the search date filters' placeholder to MM/DD/YYYY
 * but never converted the typed value: the filter still reaches the
 * search query as typed, and the query validator only accepts
 * YYYY-MM-DD, so any search with a typed modified-date filter is
 * rejected whole — the status line reports "Could not query the search
 * index." and no results display. The filter persists, so every later
 * search fails too until the filters are cleared.
 *
 * These tests fail on unfixed code and pass once the typed date is
 * converted to the ISO form the query requires.
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

async function openFilters(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Search', exact: true });
  await button.click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  await page.getByText('Search filters', { exact: true }).click();
}

test('a typed MM/DD/YYYY modified-date filter still shows matching results', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await openFilters(page);
    await page.getByLabel('Modified on or after').fill('01/01/2026');
    const input = page.getByLabel('Global search');
    await input.fill('review');
    await expect(page.getByRole('button', { name: 'Note: Review note' })).toBeVisible();
    await expect(statusLine(page)).toContainText(/search results shown/);
  } finally {
    await closeApp(app, paths);
  }
});

test('a typed MM/DD/YYYY modified-date filter narrows results to matching dates', async () => {
  const { app, page, paths } = await launchSearchApp();
  try {
    await openFilters(page);
    // The seeded note was modified today; a "before" date in the past
    // must exclude it, proving the filter actually applies — and the
    // status line must report a completed search, not a failed query.
    await page.getByLabel('Modified on or before').fill('01/01/2020');
    const input = page.getByLabel('Global search');
    await input.fill('review');
    await expect(page.getByText('0 results shown')).toBeVisible();
    await expect(statusLine(page)).toContainText('0 search results shown');
    await expect(page.getByRole('button', { name: 'Note: Review note' })).toHaveCount(0);
  } finally {
    await closeApp(app, paths);
  }
});
