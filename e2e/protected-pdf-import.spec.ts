import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  runPaletteCommand,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Protected-PDF import end-to-end pass (Tristen, 1.9.19 retest):
 * a permission-protected PDF and a password-protected PDF both import
 * as read-only managed documents instead of being refused with
 * "Protected PDFs cannot be imported as managed documents."
 *
 * The permission fixture is the committed unit-test fixture
 * (src/test/fixtures/permission-protected.pdf: one page, readable
 * text, one required text field; no user password, owner password set,
 * only form filling allowed). The password fixture is the existing
 * e2e/fixtures/fillable-protected.pdf (user password "test123").
 * Both open in the reading view; filling still saves in the app, but
 * notes and a filled file are unavailable, with a clear read-only
 * notice and a disabled export.
 */

async function launchImportApp() {
  const paths = seedLibrary([{ name: 'Seeded', files: [{ name: 'Seeded note.md', content: '# Seeded note\n' }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Seeded' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

async function stubImportDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: paths,
    });
  }, filePaths);
}

function writeFixture(paths: SeedPaths, name: string, content: Buffer): string {
  const fixtureDir = path.join(paths.baseDir, 'fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, name);
  writeFileSync(fixturePath, content);
  return fixturePath;
}

async function importAsCopy(app: ElectronApplication, page: Page, fixturePath: string, fileName: string) {
  await openNotebook(page, 'Seeded');
  await stubImportDialog(app, [fixturePath]);
  await runPaletteCommand(page, 'Import file');
  const dialog = page.getByRole('dialog', { name: 'Import file' });
  // PDF validation loads pdf.js in the main process on first use,
  // which is slow on a cold start: allow the same 30s as the grid.
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByRole('radio', { name: /Make a copy/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('gridcell', { name: fileName })).toBeVisible({ timeout: 30000 });
  await expect(statusLine(page)).toContainText(`Imported ${fileName}. The original file was kept.`, {
    timeout: 30000,
  });
}

test('permission-protected PDF imports as a read-only copy and reads with its field', async () => {
  let launched: Awaited<ReturnType<typeof launchImportApp>> | null = null;
  try {
    launched = await launchImportApp();
    const { app, page, paths } = launched;
    const fixture = new Uint8Array(
      readFileSync(path.join(__dirname, '..', 'src', 'test', 'fixtures', 'permission-protected.pdf')),
    );
    const fixturePath = writeFixture(paths, 'permission-protected.pdf', Buffer.from(fixture));
    await importAsCopy(app, page, fixturePath, 'permission-protected.pdf');

    await openGridEntry(page, 'permission-protected.pdf');
    // The page text lives in both the accessible text and the visual
    // text layer: scope to the accessible text so the assertion is
    // unambiguous.
    await expect(
      page.getByRole('region', { name: 'Accessible text for PDF page 1' }).getByText('Protected import fixture'),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Form fields' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Your full name (required)')).toBeVisible();

    // Read-only, stated up front: notes and a filled file are
    // unavailable, and the export is disabled.
    await expect(
      page.getByText('This PDF is protected, so it opens read-only: notes and a filled file are unavailable.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download filled PDF' })).toBeDisabled();

    // Filling still works in the app: the value is saved, only the
    // filled file cannot be created.
    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    const formSection = page.getByRole('region', { name: 'Form fields' });
    await expect(formSection.getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });

    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('password-protected PDF imports as a copy, then asks once and fills in the app', async () => {
  let launched: Awaited<ReturnType<typeof launchImportApp>> | null = null;
  try {
    launched = await launchImportApp();
    const { app, page, paths } = launched;
    const fixture = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'fillable-protected.pdf')));
    const fixturePath = writeFixture(paths, 'Locked.pdf', Buffer.from(fixture));
    await importAsCopy(app, page, fixturePath, 'Locked.pdf');

    await openGridEntry(page, 'Locked.pdf');
    await expect(page.getByRole('heading', { name: 'Password-protected PDF' })).toBeVisible({ timeout: 30000 });
    await page.getByLabel('PDF password').fill('test123');
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await expect(page.getByRole('heading', { name: 'Form fields' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Your full name (required)')).toBeVisible();

    await expect(page.getByText('This PDF is password-protected, so a filled file cannot be created.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download filled PDF' })).toBeDisabled();

    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    const formSection = page.getByRole('region', { name: 'Form fields' });
    await expect(formSection.getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });

    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});
