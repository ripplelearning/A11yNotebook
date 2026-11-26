import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openNotebook,
  pressShortcut,
  seedLibrary,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Regression tests for the 1.9.22 retest items: the New Task dialog
 * (and the Create Reminder dialog) showed and asked for dates as
 * YYYY-MM-DD. Dates the user sees and types are MM/DD/YYYY; storage
 * stays ISO, so the created task's due date must read back in
 * MM/DD/YYYY in the Tasks table too.
 */

function displayDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

async function launchTasksApp(): Promise<{ app: ElectronApplication; page: Page; paths: SeedPaths }> {
  const paths = seedLibrary([
    {
      name: 'Archive',
      files: [{ name: 'Guide.md', content: '# Guide\n\nArchive guide.\n' }],
    },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await dismissTutorial(page);
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
  await openNotebook(page, 'Archive');
  // The Tasks view always reports its task count; the 'New task' button
  // itself only renders when command buttons are shown (off by default),
  // so it cannot be the view check. The dialog opens via the palette.
  await switchView(page, 'Control+4', async () => page.getByText(/tasks shown\./).count());
  return { app, page, paths };
}

test('the New task dialog accepts MM/DD/YYYY dates and shows them back that way', async () => {
  const { app, page, paths } = await launchTasksApp();
  try {
    // Ctrl+N is "New in current view": on the Tasks view it opens the
    // same unified New task dialog as the grid menu and the palette —
    // one dialog, with an Associate with dropdown, for every entry point.
    await pressShortcut(page, 'Control+N');
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // The fields ask for MM/DD/YYYY, never YYYY-MM-DD.
    await expect(dialog.getByLabel('Due date, MM/DD/YYYY')).toBeVisible();
    await expect(dialog.getByLabel('Reminder date, MM/DD/YYYY')).toBeVisible();
    expect(await dialog.getByLabel('Due date, MM/DD/YYYY').getAttribute('placeholder')).toBe('MM/DD/YYYY');

    // The unified dialog associates the task with a note: the seeded
    // note is the default, not a new task file.
    await expect(dialog.getByLabel('Associate with')).toHaveValue('Archive/Guide.md', { timeout: 10000 });

    const due = displayDate(5);
    await dialog.getByLabel('Task description').fill('File the quarterly report');
    await dialog.getByLabel('Due date, MM/DD/YYYY').fill(due);
    await dialog.getByLabel('Reminder date, MM/DD/YYYY').fill(displayDate(4));
    await dialog.getByLabel('Reminder time, HH:MM').fill('09:00');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    // The dialog closes and the task lists in the Tasks table with its
    // due date shown as MM/DD/YYYY, linked to the note it lives in.
    await expect(dialog).toBeHidden({ timeout: 5000 });
    const row = page.locator('tr[data-context="task-row"]', { hasText: 'File the quarterly report' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row).toContainText(due);
    await expect(row).not.toContainText('2026-');
    await expect(page.getByRole('button', { name: 'Open note: Archive/Guide.md' })).toBeVisible({
      timeout: 5000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('the New task dialog rejects an impossible MM/DD/YYYY date', async () => {
  const { app, page, paths } = await launchTasksApp();
  try {
    await pressShortcut(page, 'Control+N');
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.getByLabel('Task description').fill('Impossible date task');
    await dialog.getByLabel('Due date, MM/DD/YYYY').fill('02/30/2026');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    await expect(dialog.getByRole('alert')).toContainText('Enter a due date as MM/DD/YYYY.');
    await expect(dialog).toBeVisible();
    await expect(
      page.locator('tr[data-context="task-row"]', { hasText: 'Impossible date task' }),
    ).toHaveCount(0);
  } finally {
    await closeApp(app, paths);
  }
});
