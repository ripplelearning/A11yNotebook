import { test, expect, type Page } from '@playwright/test';
import {
  clickNativeMenuItem,
  closeApp,
  dismissTutorial,
  launchApp,
  nativeMenuItemState,
  seedLibrary,
  waitForApp,
} from './helpers';

async function setTutorialState(page: Page, state: { suppressed: boolean; lastVersionSeen: string }): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify(value));
  }, state);
}

async function readSuppressed(page: Page): Promise<boolean> {
  return page.evaluate(
    () => JSON.parse(window.localStorage.getItem('a11y-notebook.tutorial') ?? '{}').suppressed as boolean,
  );
}

// Regression for the 1.9.16 trap Tristen reported Nov 16, 2026: she
// checked "Don't show this again", updated to 1.9.17, the tour correctly
// did not auto-show — but she then had no way to re-enable it, view it on
// demand, or see What's New. Help > Tutorial and Help > What's New must
// always be reachable, and the checkbox must actually control the
// auto-show after the next update.
test('Help menu Tutorial re-enables the tour after it was suppressed', async () => {
  const paths = seedLibrary([{ name: 'Notebook', files: [{ name: 'Note.md', content: '# Note\n' }] }]);
  let { app, page } = await launchApp(paths.userDataDir);
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    // Tristen's state: suppressed in 1.9.16, now running 1.9.17.
    await setTutorialState(page, { suppressed: true, lastVersionSeen: '1.9.16' });
    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole('dialog', { name: 'Welcome Tutorial' })).toHaveCount(0);

    // The Help entry is present and enabled even while suppressed.
    await expect.poll(async () => (await nativeMenuItemState(app, 'show-tutorial')).enabled).toBe(true);
    await clickNativeMenuItem(app, 'show-tutorial');
    const tutorial = page.getByRole('dialog', { name: 'Welcome Tutorial' });
    await expect(tutorial).toBeVisible();
    await expect(tutorial.getByRole('heading', { name: 'Welcome to A11y Notebook' })).toBeVisible();

    // The box starts unchecked while suppressed; checking it re-enables the tour.
    const checkbox = tutorial.getByRole('checkbox', { name: 'Show the tutorial after each update' });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect.poll(() => readSuppressed(page)).toBe(false);
    await tutorial.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tutorial).toHaveCount(0);

    // The stored version is still older, so the re-enabled tour shows after a restart.
    // A real restart, not page.reload: a second reload in one session leaves
    // the renderer blank in this harness — a pre-existing quirk, verified
    // on clean main with no tutorial interaction at all.
    await app.close();
    ({ app, page } = await launchApp(paths.userDataDir));
    await waitForApp(page);
    await expect(page.getByRole('dialog', { name: 'Welcome Tutorial' })).toBeVisible();
    await dismissTutorial(page);
  } finally {
    await closeApp(app, paths);
  }
});

test("Help menu What's New shows only the last tutorial page", async () => {
  const paths = seedLibrary([{ name: 'Notebook', files: [{ name: 'Note.md', content: '# Note\n' }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await expect.poll(async () => (await nativeMenuItemState(app, 'show-whats-new')).enabled).toBe(true);
    await clickNativeMenuItem(app, 'show-whats-new');
    const whatsNew = page.getByRole('dialog', { name: "What's New" });
    await expect(whatsNew).toBeVisible();
    await expect(whatsNew.getByRole('heading', { name: /What's new in version/ })).toBeVisible();
    await expect(whatsNew.getByRole('heading', { name: 'What changed' })).toBeVisible();
    // Nothing from the earlier tour pages leaks in.
    await expect(whatsNew.getByRole('heading', { name: 'Welcome to A11y Notebook' })).toHaveCount(0);
    await expect(whatsNew.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await expect(whatsNew.getByRole('button', { name: 'Previous' })).toHaveCount(0);
    await expect(whatsNew.getByRole('checkbox')).toHaveCount(0);
    await whatsNew.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(whatsNew).toHaveCount(0);
  } finally {
    await closeApp(app, paths);
  }
});

test('unchecking the box keeps the tour suppressed after an update', async () => {
  const paths = seedLibrary([{ name: 'Notebook', files: [{ name: 'Note.md', content: '# Note\n' }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  try {
    await waitForApp(page);
    // Fresh profile: the tour auto-shows.
    const tutorial = page.getByRole('dialog', { name: 'Welcome Tutorial' });
    await expect(tutorial).toBeVisible({ timeout: 10000 });
    const checkbox = tutorial.getByRole('checkbox', { name: 'Show the tutorial after each update' });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect.poll(() => readSuppressed(page)).toBe(true);
    await tutorial.getByRole('button', { name: 'Close', exact: true }).click();
    // Simulate the next update arriving: the stored version is older, but suppressed wins.
    await setTutorialState(page, { suppressed: true, lastVersionSeen: '1.9.16' });
    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole('dialog', { name: 'Welcome Tutorial' })).toHaveCount(0);
  } finally {
    await closeApp(app, paths);
  }
});
