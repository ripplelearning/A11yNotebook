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
 * Regression tests for the 1.9.20 retest item: from the Notes and Files
 * grid, Shift+F10 and the Applications key opened different context menus.
 *
 * Root cause: the keydown handler opens the item menu and focus moves to
 * its first item, but Windows also delivers a trailing `contextmenu` event
 * for the Applications key after the keydown (Shift+F10 delivers none —
 * its contextmenu is the keydown's default action, suppressed by
 * preventDefault). That trailing event targets the focused menu item,
 * which carries no data-context, so the window `contextmenu` listener
 * re-opened the menu with the 'general' context and swapped the item
 * menu ("Actions for …") for the Application menu. The listener now
 * ignores contextmenu events aimed at the open menu itself, so whichever
 * key opens the menu first wins and a trailing event cannot swap it.
 *
 * CDP-dispatched keys do not produce the OS trailing event, so the test
 * dispatches the trailing `contextmenu` event on the focused element
 * directly — the same bubbling, cancelable event the browser dispatches
 * for a keyboard invocation, targeted at the focused element.
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
}

async function launchGridApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([{ name: 'Archive', files: [{ name: 'Guide.md', content: '# Guide\n\nArchive guide.\n' }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
  await openNotebook(page, 'Archive');
  const cell = page.getByRole('gridcell', { name: 'Guide.md', exact: true });
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.click();
  await expect(cell).toBeFocused();
  return { app, page, paths };
}

interface MenuSnapshot {
  label: string;
  items: string[];
}

async function readMenu(page: Page): Promise<MenuSnapshot> {
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  return {
    label: (await menu.getAttribute('aria-label')) ?? '',
    items: (await page.getByRole('menuitem').allTextContents()).map((item) => item.trim()),
  };
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Dispatch a trailing contextmenu event on the focused element, as the
 * browser does for a keyboard invocation after the menu is already open. */
async function dispatchTrailingContextMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  });
  await page.waitForTimeout(300);
}

test('Shift+F10 and the Applications key open the same menu in the Notes and Files grid', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    const cell = page.getByRole('gridcell', { name: 'Guide.md', exact: true });

    await page.keyboard.press('Shift+F10');
    const shiftF10Menu = await readMenu(page);
    expect(shiftF10Menu.label).toBe('Actions for Guide.md');
    expect(shiftF10Menu.items).toContain('Open selected item');
    await closeMenu(page);
    // Focus returns to the grid cell that opened the menu.
    await expect(cell).toBeFocused();

    await page.keyboard.press('ContextMenu');
    const appsKeyMenu = await readMenu(page);
    await closeMenu(page);
    await expect(cell).toBeFocused();

    expect(appsKeyMenu).toEqual(shiftF10Menu);

    // Right-click is the reference: the same item menu.
    await cell.click({ button: 'right' });
    const rightClickMenu = await readMenu(page);
    await closeMenu(page);
    expect(rightClickMenu).toEqual(shiftF10Menu);
  } finally {
    await closeApp(app, paths);
  }
});

test('a trailing contextmenu event while the menu is open does not swap it', async () => {
  const { app, page, paths } = await launchGridApp();
  try {
    for (const opener of ['Shift+F10', 'ContextMenu'] as const) {
      await page.keyboard.press(opener);
      const opened = await readMenu(page);
      expect(opened.label).toBe('Actions for Guide.md');
      // The menu is open and its first item is focused: the trailing
      // event targets that item, which has no data-context.
      await expect(page.getByRole('menuitem').first()).toBeFocused();
      await dispatchTrailingContextMenu(page);
      const after = await readMenu(page);
      expect(after).toEqual(opened);
      await closeMenu(page);
    }
  } finally {
    await closeApp(app, paths);
  }
});
