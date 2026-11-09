import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const ELECTRON_PATH = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');

/**
 * Dismiss the first-run Welcome Tutorial if it is open. The tour opens
 * on a fresh profile (or after an update, when the stored version is
 * older) and its modal blocks command shortcuts and makes the rest of
 * the shell inert, so every spec must dismiss it before interacting
 * with the app. Clicking Close is the real user path; closing also
 * records the current version, so the tour does not reopen in the same
 * profile.
 *
 * The tour opens shortly after launch once no library switch is in
 * flight, so wait briefly for it to appear instead of assuming it is
 * already there. If it never appears (already suppressed or seen),
 * this is a no-op.
 */
export async function dismissTutorial(page: Page): Promise<void> {
  const tutorial = page.getByRole('dialog', { name: 'Welcome Tutorial' });
  try {
    await tutorial.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    return;
  }
  await tutorial.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(tutorial).toHaveCount(0);
}

export interface SeedFile {
  name: string;
  content: string | Uint8Array;
}

export interface SeedNotebook {
  name: string;
  files: SeedFile[];
}

export interface SeedPaths {
  libraryDir: string;
  userDataDir: string;
  baseDir: string;
}

/**
 * Seed a throwaway library on disk and point a fresh user-data dir at it,
 * so the app launches with the library open exactly as a returning user
 * would. Notes (Markdown/HTML/text) are recorded as app-created in the
 * provenance sidecar, keyed the way the app keys them (SHA-256 of the
 * file's device, inode, and birth time); without that record the app
 * treats a note as an external file and opens an "Open external file"
 * dialog instead. Attachments (.csv, .xlsx, .pdf, .epub, …) need no
 * provenance record: the vault scan picks them up as attachments.
 */
export function seedLibrary(notebooks: SeedNotebook[]): SeedPaths {
  const baseDir = mkdtempSync(path.join(tmpdir(), 'a11y-e2e-verify-'));
  const libraryDir = path.join(baseDir, 'library');
  const userDataDir = path.join(baseDir, 'user-data');
  mkdirSync(path.join(libraryDir, '.a11ynotebook'), { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  const provenance: Record<string, string> = {};
  for (const notebook of notebooks) {
    const notebookDir = path.join(libraryDir, notebook.name);
    mkdirSync(notebookDir, { recursive: true });
    for (const file of notebook.files) {
      const filePath = path.join(notebookDir, file.name);
      writeFileSync(filePath, file.content);
      if (/\.(md|html?|txt)$/i.test(file.name)) {
        const stat = statSync(filePath);
        if (!stat.isFile() || stat.ino <= 0 || stat.birthtimeMs <= 0) {
          throw new Error(`Seed note ${file.name} has no usable file identity for provenance.`);
        }
        const identity = createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`).digest('hex');
        provenance[identity] = 'created';
      }
    }
  }
  writeFileSync(
    path.join(libraryDir, '.a11ynotebook', 'provenance.json'),
    JSON.stringify({ version: 1, records: provenance }, null, 2),
    'utf8',
  );
  const now = new Date();
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

export async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  });
  const page = await app.firstWindow();
  return { app, page };
}

export async function closeApp(app: ElectronApplication | null, paths: SeedPaths): Promise<void> {
  await app?.close();
  try {
    rmSync(paths.baseDir, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover temp dir never fails the test.
  }
}

/**
 * Wait for the app shell to render. Cold Vite compile can lag the first
 * render well past the default 5s expect timeout, so use the full 30s.
 */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/A11y Notebook/);
  await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible({ timeout: 30000 });
}

/** The footer status line, where the app reports saves, jumps, and errors. */
export function statusLine(page: Page) {
  return page.getByRole('contentinfo', { name: 'Status bar' }).getByRole('status');
}

/**
 * View shortcuts race the keydown listener attaching after mount, so
 * retry the switch until the view's content actually appears.
 */
export async function switchView(page: Page, shortcut: string, content: () => Promise<number>): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await content()) > 0) return;
    await page.keyboard.press(shortcut);
    await page.waitForTimeout(500);
  }
  expect(await content()).toBeGreaterThan(0);
}

/**
 * Open a notebook from the Notes & Files grid (double-click its row), which
 * selects it and switches to Notes & Files for that notebook. `name` is
 * the leaf name shown in the row; `notebookPath` is the full relative path
 * shown in the "Items in …" text (they differ for nested notebooks).
 */
export async function openNotebook(page: Page, name: string, notebookPath: string = name): Promise<void> {
  const row = page.getByRole('row', { name: new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+notebook`) });
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.dblclick();
  await expect(page.getByText(`Items in ${notebookPath}`, { exact: true })).toBeVisible({ timeout: 30000 });
}

/** Open a row in the Notes & Files grid by its file name. */
export async function openGridEntry(page: Page, name: string): Promise<void> {
  const cell = page.getByRole('gridcell', { name, exact: true });
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.dblclick();
}

/**
 * Run a command through the command palette (Ctrl+Shift+P), the user path
 * for commands with no default shortcut. The palette filters by label;
 * the button is matched exactly so "New note" does not pick
 * "New note from template".
 */
export async function runPaletteCommand(page: Page, label: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await page.getByRole('dialog', { name: 'Command palette' }).count()) > 0) break;
    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(500);
  }
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder('Search Command Palette').fill(label);
  await palette.getByRole('button', { name: label, exact: true }).click();
}
