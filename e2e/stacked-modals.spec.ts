import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  pressShortcut,
  seedLibrary,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Stacked modals end-to-end pass (1.9.23 retest, remaining issue 3):
 * two Modals mounted at once used to fight over focus — each enforced
 * its own trap, so the modal beneath yanked focus back the moment the
 * top modal took it. Only the top modal may own focus; closing it
 * returns focus to the modal beneath.
 *
 * How the two dialogs get stacked here: the palette opens by its real
 * keyboard shortcut, then the search dialog opens over it. The Search
 * button needs a forced click because the palette's full-screen
 * backdrop intercepts real pointer clicks — and the keyboard, native
 * menu, and context-menu routes all refuse while a dialog is open
 * (handleGlobalKeyDown's dialog guard, the onMenuCommand guard, and
 * the contextmenu guard), so no unforced path stacks the two in this
 * build. The stack itself is real app state, and the async paths the
 * guards do not cover (a due-reminder alert, a file-conflict dialog)
 * can still stack two modals — which is what this Modal fix covers.
 *
 * Screen-reader announcements cannot be checked here; Tristen's manual
 * retest remains the only check for what is spoken.
 */

async function launchStackedApp(): Promise<{ app: ElectronApplication; page: Page; paths: SeedPaths }> {
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

async function openPalette(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await page.getByRole('dialog', { name: 'Command palette' }).count()) > 0) break;
    await pressShortcut(page, 'Control+Shift+P');
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
}

async function expectFocusInsideDialog(page: Page, titleId: string): Promise<void> {
  const inside = await page.evaluate((id) => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return active.closest('[role="dialog"]')?.getAttribute('aria-labelledby') === id;
  }, titleId);
  expect(inside).toBe(true);
}

test('search dialog over the palette owns focus and Escape returns to the palette', async () => {
  const { app, page, paths } = await launchStackedApp();
  try {
    await openPalette(page);
    const paletteInput = page.getByPlaceholder('Search Command Palette');
    await expect(paletteInput).toBeFocused();

    // The search dialog opens over the palette and becomes the top modal.
    // dispatchEvent, not a real pointer click: the palette's full-screen
    // backdrop intercepts real clicks, and a force click still lands on
    // the backdrop at the button's coordinates. The click itself is the
    // real openSearchDialog transition; only its delivery is synthetic.
    await page.getByRole('button', { name: 'Search', exact: true }).dispatchEvent('click');
    const searchDialog = page.getByRole('dialog', { name: 'Search' });
    await expect(searchDialog).toBeVisible();
    await expect(page.getByLabel('Global search')).toBeFocused();

    // Shift+Tab from the search box moves to the dialog's Close button,
    // staying inside the search dialog — not into the palette beneath it.
    // Scoped to the search dialog: the palette's command list also has
    // "Close tab" / "Close other tabs" buttons, so an unscoped name
    // match is ambiguous.
    await page.keyboard.press('Shift+Tab');
    await expect(searchDialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await expectFocusInsideDialog(page, 'search-dialog-title');

    // Escape closes only the search dialog; the palette stays open and
    // focus returns to its search box.
    await page.keyboard.press('Escape');
    await expect(searchDialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(paletteInput).toBeFocused();

    // A second Escape dismisses the palette itself, as before.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  } finally {
    await closeApp(app, paths);
  }
});
