import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { dismissTutorial, pressShortcut, waitForApp, clickNativeMenuItem, nativeMenuItemState } from './helpers';

/**
 * End-to-end pass over the F1 User Guide: F1 opens the full guide (not
 * the shortcuts-only dialog), the search box filters by section, a Table
 * of Contents entry moves keyboard focus to its section heading, and the
 * shortcuts section lists the registry's live bindings. The remapped-
 * shortcut case (a changed binding shows up without editing the guide)
 * is covered by unit tests, which can override the registry directly.
 *
 * Screen-reader announcements and virtual-cursor position cannot be
 * checked here; Tristen's retest is the only check for those.
 */

function launchOptions() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'a11y-e2e-guide-'));
  return {
    userDataDir,
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  };
}

async function closeApp(app: ElectronApplication | null, userDataDir: string) {
  await app?.close();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover temp dir never fails the test.
  }
}

async function openGuide() {
  const { userDataDir, args } = launchOptions();
  const app = await electron.launch({ args });
  const page = await app.firstWindow();
  await waitForApp(page);
  await dismissTutorial(page);
  // F1 races the keydown listener attaching after mount, so retry until
  // the guide actually appears.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await pressShortcut(page, 'F1');
    try {
      await page.getByRole('dialog', { name: 'User Guide' }).waitFor({ timeout: 2000 });
      break;
    } catch {
      // Not open yet; press F1 again.
    }
  }
  const guide = page.getByRole('dialog', { name: 'User Guide' });
  await expect(guide).toBeVisible();
  return { app, page, guide, userDataDir };
}

test('F1 opens the full User Guide with search, Table of Contents, and shortcuts', async () => {
  const { app, guide, userDataDir } = await openGuide();
  try {
    await expect(guide.getByLabel('Search the User Guide')).toBeVisible();
    await expect(guide.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
    // The full guide, not the shortcuts-only dialog: real guide sections.
    await expect(guide.getByRole('heading', { name: 'Search' })).toBeVisible();
    await expect(guide.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(guide.getByRole('heading', { name: 'Reminders and project progress' })).toBeVisible();
    // The guide opens with its three introductory parts, in order. The
    // dialog title itself is the first level-2 heading, so the parts
    // follow it.
    const partHeadings = guide.getByRole('heading', { level: 2 });
    await expect(partHeadings.nth(1)).toHaveText('Introduction to A11y Notebook');
    await expect(partHeadings.nth(2)).toHaveText('The user interface and how to navigate it using a keyboard');
    await expect(partHeadings.nth(3)).toHaveText('Accessibility features and accessibility settings');
    // The shortcuts section lists the registry's live bindings.
    const shortcutsSection = guide.locator('section[aria-labelledby="keyboard-shortcuts"]');
    await expect(shortcutsSection).toContainText('User Guide');
    await expect(shortcutsSection).toContainText('F1');
    await expect(shortcutsSection).toContainText('Toggle note bookmark');
    await expect(shortcutsSection).toContainText('Ctrl+D');
    await expect(shortcutsSection).toContainText('Jump to next bookmark');
    await expect(shortcutsSection).toContainText('Ctrl+Alt+J');
  } finally {
    await closeApp(app, userDataDir);
  }
});

test('guide search filters sections and announces the match count', async () => {
  const { app, guide, userDataDir } = await openGuide();
  try {
    await guide.getByLabel('Search the User Guide').fill('reminders');
    await expect(guide.getByRole('status')).toContainText(/sections? match/i);
    await expect(guide.getByRole('heading', { name: 'Tasks' })).toHaveCount(0);
    await expect(guide.getByRole('heading', { name: 'Reminders and project progress' })).toBeVisible();
    await guide.getByRole('button', { name: 'Clear search' }).click();
    await expect(guide.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(guide.getByLabel('Search the User Guide')).toHaveValue('');
  } finally {
    await closeApp(app, userDataDir);
  }
});

test('Table of Contents activation moves focus to the section heading', async () => {
  const { app, page, guide, userDataDir } = await openGuide();
  try {
    const toc = guide.getByRole('navigation', { name: 'Table of contents' });
    await toc.getByRole('button', { name: 'Tasks' }).click();
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      return element ? { tag: element.tagName, id: element.id, text: element.textContent?.trim() } : null;
    });
    // Tasks is a level-3 section under "Features in detail", so it
    // renders as an H3; the Table of Contents still moves focus to it.
    expect(focused).toEqual({ tag: 'H3', id: 'tasks', text: 'Tasks' });
  } finally {
    await closeApp(app, userDataDir);
  }
});

test('User Guide is reachable from the native Help menu', async () => {
  const { app, page, userDataDir } = await openGuide();
  try {
    // Close the guide opened by F1, then reopen it through Help.
    await page.getByRole('dialog', { name: 'User Guide' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'User Guide' })).toHaveCount(0);
    const state = await nativeMenuItemState(app, 'show-user-guide');
    expect(state.found).toBe(true);
    expect(state.label).toBe('User Guide');
    await clickNativeMenuItem(app, 'show-user-guide');
    await expect(page.getByRole('dialog', { name: 'User Guide' })).toBeVisible();
  } finally {
    await closeApp(app, userDataDir);
  }
});
