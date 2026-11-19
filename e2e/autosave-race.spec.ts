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
 * Autosave/manual-save race: the 900 ms autosave is scheduled on every
 * edit, and a manual Ctrl+S used to leave its timer running. When the
 * manual save's disk write landed while the autosave timer was still
 * pending — the timer firing before React re-rendered and the effect
 * cleanup cleared it — the autosave fired with the pre-save baseline
 * and threw "Note changed on disk". The manual save now clears the
 * pending autosave timer first, so the autosave can never fire with a
 * stale baseline.
 *
 * The race is timing-dependent, so each round saves 800 ms after the
 * last keystroke — 100 ms before the autosave is due — and repeats the
 * cycle three times, giving the old code three chances to fire the
 * stale autosave. With the fix every round saves cleanly.
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchAutosaveRaceApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [{ name: 'Race.md', content: '# Race\n\nBefore.\n' }],
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

test('manual save just before the autosave deadline never reports "Note changed on disk"', async () => {
  const { app, page, paths, pageErrors } = await launchAutosaveRaceApp();
  try {
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Race.md');
    await expect(page.getByRole('heading', { name: 'Race', level: 1 })).toBeVisible({ timeout: 30000 });
    await pressShortcut(page, 'Control+E');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toBeVisible({ timeout: 30000 });
    await expect(editor).toBeFocused();

    const rounds = ['# Race\n\nBefore.\n\nFirst.\n', '# Race\n\nBefore.\n\nFirst.\n\nSecond.\n', '# Race\n\nBefore.\n\nFirst.\n\nSecond.\n\nThird.\n'];
    for (const content of rounds) {
      await editor.fill(content);
      // The autosave is due 900 ms after this edit: save manually
      // 100 ms before that deadline, while its timer is pending.
      await page.waitForTimeout(800);
      await pressShortcut(page, 'Control+S');
      // Wait past the autosave window: if the stale autosave had
      // fired, the status would now read "Could not save" and the
      // conflict dialog would be open.
      await page.waitForTimeout(2000);
      await expect(statusLine(page)).toContainText('Saved Race.');
      await expect(page.getByRole('dialog', { name: 'Note changed on disk' })).toHaveCount(0);
    }

    expect(readFileSync(path.join(paths.libraryDir, 'Seeded', 'Race.md'), 'utf8')).toContain('Third.');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
