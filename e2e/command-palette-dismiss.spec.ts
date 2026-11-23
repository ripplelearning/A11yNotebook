import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  pressShortcut,
  runPaletteCommand,
  seedLibrary,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Command palette dismissal end-to-end pass (Tristen, 1.9.21 retest,
 * Nov 23, 2026): after searching for 'remi' in the Command Palette and
 * activating Create Reminder, the palette stayed open and focus never
 * moved into the new reminder dialog. The fix dismisses the palette for
 * every command, not just reminders, and Escape dismisses it anywhere
 * it can be open.
 *
 * Each test launches the real app against a seeded library and drives
 * the real palette. Screen-reader announcements and virtual-cursor
 * position cannot be checked here; Tristen's manual retest remains the
 * only check for those.
 */

async function launchPaletteApp(): Promise<{ app: ElectronApplication; page: Page; paths: SeedPaths }> {
  const paths = seedLibrary([{ name: 'Seeded', files: [{ name: 'Seeded note.md', content: '# Seeded note\n' }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  return { app, page, paths };
}

/** Open the palette, type a query, and activate the named result — Tristen's exact path. */
async function runPaletteSearch(page: Page, query: string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await page.getByRole('dialog', { name: 'Command palette' }).count()) > 0) break;
    await pressShortcut(page, 'Control+Shift+P');
    await page.waitForTimeout(500);
  }
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder('Search Command Palette').fill(query);
  await palette.getByRole('button', { name: label, exact: true }).click();
}

async function expectPaletteDismissed(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
}

async function expectFocusInsideDialog(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  // The palette is already asserted gone, so the one remaining dialog is
  // the target; focus must be inside it, not lost on the body.
  const focusedInside = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const target = document.querySelector('[role="dialog"]');
    return !!target && !!active && target.contains(active);
  });
  expect(focusedInside).toBe(true);
}

test('Create reminder from a palette search dismisses the palette and focuses the reminder dialog', async () => {
  const { app, page, paths } = await launchPaletteApp();
  try {
    await runPaletteSearch(page, 'remi', 'Create reminder');
    await expectPaletteDismissed(page);
    await expect(page.getByRole('dialog', { name: 'Create reminder' })).toBeVisible();
    await expect(page.getByLabel('Reminder title')).toBeFocused();
  } finally {
    await closeApp(app, paths);
  }
});

test('Settings from the palette dismisses the palette and focuses inside the settings dialog', async () => {
  const { app, page, paths } = await launchPaletteApp();
  try {
    await runPaletteCommand(page, 'Settings');
    await expectPaletteDismissed(page);
    await expectFocusInsideDialog(page, 'Settings');
  } finally {
    await closeApp(app, paths);
  }
});

test('Calendar from the palette dismisses the palette and leaves focus on a real element', async () => {
  const { app, page, paths } = await launchPaletteApp();
  try {
    await runPaletteCommand(page, 'Calendar');
    await expectPaletteDismissed(page);
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName(/Calendar/);
    const focusLost = await page.evaluate(() => document.activeElement === document.body);
    expect(focusLost).toBe(false);
  } finally {
    await closeApp(app, paths);
  }
});

test('Escape dismisses the palette with a query typed', async () => {
  const { app, page, paths } = await launchPaletteApp();
  try {
    await pressShortcut(page, 'Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder('Search Command Palette').fill('remi');
    await page.keyboard.press('Escape');
    await expectPaletteDismissed(page);
  } finally {
    await closeApp(app, paths);
  }
});
