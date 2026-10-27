import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const ELECTRON_PATH = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');

/**
 * Seeded-library end-to-end pass: the app launches with a library that
 * already holds a note (with tasks) and a calendar appointment, and the
 * real views render that data. The shell spec covers the app without a
 * library; this spec covers the app with one.
 *
 * Seeding uses the app's own restore path, not a test hook: the fresh
 * user-data dir gets a recent-vault.json pointing at the seeded folder,
 * so launch opens it exactly as a returning user would. The seed note
 * carries one open and one completed checkbox task (tasks are parsed
 * from note content), and the calendar file holds one timed appointment
 * today, so it always lands inside the agenda's 30-day window.
 *
 * Files the app did not create or import open behind an "Open external
 * file" dialog, so the seed also records the note as app-created in
 * the provenance sidecar, keyed the way the app keys it: the SHA-256
 * of the file's device, inode, and birth time.
 */

interface SeedPaths {
  libraryDir: string;
  userDataDir: string;
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

function seedLibrary(): SeedPaths {
  const base = mkdtempSync(path.join(tmpdir(), 'a11y-e2e-seeded-'));
  const libraryDir = path.join(base, 'library');
  const userDataDir = path.join(base, 'user-data');
  mkdirSync(path.join(libraryDir, 'Seeded'), { recursive: true });
  mkdirSync(path.join(libraryDir, '.a11ynotebook'), { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  const notePath = path.join(libraryDir, 'Seeded', 'Seeded note.md');
  writeFileSync(
    notePath,
    '# Seeded note\n\nA seeded note for end-to-end tests.\n\n' +
      '- [ ] Call the dentist <!-- a11y-task-id:seedtask1 -->\n' +
      '- [x] Water the plants\n',
    'utf8',
  );
  // Provenance key, mirroring electron/vault/provenance.ts: without a
  // 'created' record the app treats the note as an external file and
  // opens an "Open external file" dialog instead of the note.
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
            id: 'seed-appt-1',
            title: 'Seeded dentist appointment',
            start: `${localDateString(now)}T10:00:00${localOffsetString(now)}`,
            allDay: false,
            location: 'Seeded clinic',
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
        recent: [
          { path: libraryDir, name: 'library', lastOpenedAt: now.toISOString() },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  return { libraryDir, userDataDir };
}

async function closeApp(app: ElectronApplication | null, paths: SeedPaths) {
  await app?.close();
  try {
    rmSync(path.dirname(paths.libraryDir), { recursive: true, force: true });
  } catch {
    // Best effort: a leftover temp dir never fails the test.
  }
}

test('seeded library opens with its note, tasks, and appointment', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary();
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${paths.userDataDir}`],
    });
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await expect(page).toHaveTitle(/A11y Notebook/);
    // Cold Vite compile can lag the first render well past the default
    // 5s expect timeout; the banner is the load gate.
    await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible({
      timeout: 30000,
    });

    // View shortcuts race the keydown listener attaching after mount,
    // like the Settings shortcut in the shell spec: retry each switch
    // until its content actually appears.
    async function switchView(shortcut: string, content: () => Promise<number>) {
      for (let attempt = 0; attempt < 6; attempt++) {
        if ((await content()) > 0) return;
        await page.keyboard.press(shortcut);
        await page.waitForTimeout(500);
      }
      expect(await content()).toBeGreaterThan(0);
    }

    // Notes & Files: the seeded notebook is in the navigation tree
    // collapsed, so expand it, then open the note and check its heading
    // in reading view. The tree waits for the library itself to finish
    // opening, which lags the banner on a cold start, so these waits
    // use the full auto-wait instead of the shortcut retry below.
    // The treeitem name carries a space before the kind suffix
    // ("Seeded , notebook"), so the match allows that space.
    const notebookItem = page.getByRole('treeitem', { name: /Seeded\s*,\s*notebook/ });
    await expect(notebookItem).toBeVisible({ timeout: 30000 });
    await notebookItem.click();
    const noteItem = page.getByRole('treeitem', { name: /Seeded note\.md/ });
    await expect(noteItem).toBeVisible();
    await noteItem.click();
    // The note tab carries its own h2 title as well as the rendered
    // Markdown h1; the h1 is the note content itself.
    await expect(
      page.getByRole('heading', { name: 'Seeded note', level: 1 }),
    ).toBeVisible();

    // Tasks: the open task is unchecked. The status filter defaults to
    // Open, so switch it to All before checking the completed task.
    const taskRow = (text: string) =>
      page.locator('tr[data-context="task-row"]', { hasText: text });
    await switchView('Control+4', async () => taskRow('Call the dentist').count());
    await expect(taskRow('Call the dentist').getByRole('checkbox')).not.toBeChecked();
    await expect(taskRow('Water the plants')).toHaveCount(0);
    await page.getByLabel('Task status').selectOption('all');
    await expect(taskRow('Water the plants').getByRole('checkbox')).toBeChecked();

    // Calendar: the agenda shows today's seeded appointment.
    await switchView('Control+6', async () =>
      page.getByText('Seeded dentist appointment', { exact: true }).count(),
    );
    await expect(page.getByRole('region', { name: 'Agenda' })).toBeVisible();
    await expect(page.getByText('Seeded dentist appointment', { exact: true })).toBeVisible();
    await expect(page.getByText(/Seeded clinic/)).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
