import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { canonicalTempDir, dismissTutorial, switchView } from './helpers';

/**
 * Delete-one-occurrence end-to-end pass: a seeded library holds a weekly
 * recurring appointment and a single appointment, both today, so they
 * land inside the agenda's 30-day window. The tests drive the real
 * delete confirmation from an agenda occurrence: deleting one occurrence
 * removes only that occurrence, leaves the rest of the series, and
 * survives closing and reopening the app (the exclusion is stored with
 * the series in calendar.json). Whole-series and single-appointment
 * deletes keep their existing behavior.
 *
 * Seeding uses the app's own restore path, not a test hook: the fresh
 * user-data dir gets a recent-vault.json pointing at the seeded folder,
 * so launch opens it exactly as a returning user would. The seed note
 * carries the provenance record the app needs to treat it as
 * app-created, keyed the way the app keys it: the SHA-256 of the file's
 * device, inode, and birth time.
 */

interface SeedPaths {
  libraryDir: string;
  userDataDir: string;
  baseDir: string;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localOffsetString(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function localDateTime(date: Date, time: string): string {
  return `${localDateString(date)}T${time}:00${localOffsetString(date)}`;
}

function seedLibrary(): SeedPaths {
  const baseDir = mkdtempSync(path.join(canonicalTempDir(), 'a11y-e2e-delete-occ-'));
  const libraryDir = path.join(baseDir, 'library');
  const userDataDir = path.join(baseDir, 'user-data');
  mkdirSync(path.join(libraryDir, 'Seeded'), { recursive: true });
  mkdirSync(path.join(libraryDir, '.a11ynotebook'), { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  const notePath = path.join(libraryDir, 'Seeded', 'Seeded note.md');
  writeFileSync(notePath, '# Seeded note\n\nA seeded note for end-to-end tests.\n', 'utf8');
  const noteStat = statSync(notePath);
  if (!noteStat.isFile() || noteStat.ino <= 0 || noteStat.birthtimeMs <= 0) {
    throw new Error('Seed note has no usable file identity for provenance.');
  }
  const noteIdentity = createHash('sha256')
    .update(`${noteStat.dev}:${noteStat.ino}:${noteStat.birthtimeMs}`)
    .digest('hex');
  writeFileSync(
    path.join(libraryDir, '.a11ynotebook', 'provenance.json'),
    JSON.stringify({ version: 1, records: { [noteIdentity]: 'created' } }, null, 2),
    'utf8',
  );
  const now = new Date();
  writeFileSync(
    path.join(libraryDir, '.a11ynotebook', 'calendar.json'),
    JSON.stringify(
      {
        version: 1,
        appointments: [
          {
            id: 'seed-weekly-1',
            title: 'Standup',
            start: localDateTime(now, '09:00'),
            allDay: false,
            recurrence: { frequency: 'weekly', interval: 1 },
          },
          {
            id: 'seed-single-1',
            title: 'Dentist',
            start: localDateTime(now, '14:30'),
            allDay: false,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    path.join(userDataDir, 'recent-vault.json'),
    JSON.stringify(
      {
        lastOpened: libraryDir,
        recent: [{ path: libraryDir, name: 'library', lastOpenedAt: now.toISOString() }],
      },
      null,
      2,
    ),
    'utf8',
  );
  return { libraryDir, userDataDir, baseDir };
}

async function launch(paths: SeedPaths): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
  });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle(/A11y Notebook/);
  await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('gridcell', { name: 'Seeded' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await switchView(page, 'Control+6', async () =>
    page.getByRole('button', { name: 'Edit Standup' }).count(),
  );
  await expect(page.getByRole('region', { name: 'Agenda' })).toBeVisible();
  return { app, page };
}

function calendarFile(paths: SeedPaths): { appointments: { id: string; excludedOccurrences?: string[] }[] } {
  return JSON.parse(
    readFileSync(path.join(paths.libraryDir, '.a11ynotebook', 'calendar.json'), 'utf8'),
  ) as { appointments: { id: string; excludedOccurrences?: string[] }[] };
}

async function openDeleteConfirmation(page: Page, editButtonName: string, index: number) {
  const editButtons = page.getByRole('button', { name: editButtonName });
  await expect(editButtons.nth(index)).toBeVisible();
  await editButtons.nth(index).click();
  await expect(page.getByRole('dialog', { name: 'Edit appointment' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete appointment' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete appointment' });
  await expect(confirm).toBeVisible();
  return confirm;
}

test('deleting one occurrence removes only it and survives close and reopen', async () => {
  const paths = seedLibrary();
  const pageErrors: string[] = [];
  let app: ElectronApplication | null = null;
  try {
    const launched = await launch(paths);
    app = launched.app;
    const page = launched.page;
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const standup = page.getByRole('button', { name: 'Edit Standup' });
    await expect(standup).toHaveCount(5);

    // The second occurrence, a week from today.
    const confirm = await openDeleteConfirmation(page, 'Edit Standup', 1);
    await expect(confirm.getByText(/Delete only the occurrence on/)).toBeVisible();
    const deleteOne = confirm.getByRole('button', { name: 'Delete this appointment only' });
    await expect(deleteOne).toBeVisible();
    await expect(deleteOne).toBeFocused();
    await deleteOne.click();
    await expect(page.getByRole('dialog', { name: 'Edit appointment' })).toHaveCount(0);
    await expect(
      page.getByRole('main', { name: 'Main content' }).getByText('Deleted this occurrence.'),
    ).toBeVisible();
    await expect(standup).toHaveCount(4);

    // The exclusion is stored with the series, keyed by the deleted
    // occurrence's start.
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    await expect
      .poll(() => calendarFile(paths).appointments.find((item) => item.id === 'seed-weekly-1'))
      .toMatchObject({ excludedOccurrences: [localDateTime(nextWeek, '09:00')] });

    // Close and reopen: the deleted occurrence stays gone.
    await app.close();
    app = null;
    const relaunched = await launch(paths);
    app = relaunched.app;
    const reopened = relaunched.page;
    reopened.on('pageerror', (error) => pageErrors.push(String(error)));
    await expect(reopened.getByRole('button', { name: 'Edit Standup' })).toHaveCount(4);
    await expect(reopened.getByText('Dentist', { exact: true })).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
    rmSync(paths.baseDir, { recursive: true, force: true });
  }
});

test('deleting the whole series still removes every occurrence', async () => {
  const paths = seedLibrary();
  const pageErrors: string[] = [];
  let app: ElectronApplication | null = null;
  try {
    const launched = await launch(paths);
    app = launched.app;
    const page = launched.page;
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const standup = page.getByRole('button', { name: 'Edit Standup' });
    await expect(standup).toHaveCount(5);

    const confirm = await openDeleteConfirmation(page, 'Edit Standup', 0);
    await confirm.getByRole('button', { name: 'Delete the whole series' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit appointment' })).toHaveCount(0);
    await expect(
      page.getByRole('main', { name: 'Main content' }).getByText('Deleted the whole series.'),
    ).toBeVisible();
    await expect(standup).toHaveCount(0);
    await expect(page.getByText('Dentist', { exact: true })).toBeVisible();
    await expect
      .poll(() => calendarFile(paths).appointments.map((item) => item.id))
      .toEqual(['seed-single-1']);

    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
    rmSync(paths.baseDir, { recursive: true, force: true });
  }
});

test('deleting a single appointment is unchanged', async () => {
  const paths = seedLibrary();
  const pageErrors: string[] = [];
  let app: ElectronApplication | null = null;
  try {
    const launched = await launch(paths);
    app = launched.app;
    const page = launched.page;
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await expect(page.getByRole('button', { name: 'Edit Standup' })).toHaveCount(5);

    const confirm = await openDeleteConfirmation(page, 'Edit Dentist', 0);
    await expect(confirm.getByText('Delete this appointment?')).toBeVisible();
    await expect(
      confirm.getByRole('button', { name: 'Delete this appointment only' }),
    ).toHaveCount(0);
    await expect(confirm.getByRole('button', { name: 'Delete the whole series' })).toHaveCount(0);
    const deleteButton = confirm.getByRole('button', { name: 'Delete appointment' });
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    await expect(page.getByRole('dialog', { name: 'Edit appointment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Dentist' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Standup' })).toHaveCount(5);

    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
    rmSync(paths.baseDir, { recursive: true, force: true });
  }
});
