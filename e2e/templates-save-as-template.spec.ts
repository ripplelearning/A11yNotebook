import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  pressShortcut,
  runPaletteCommand,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Save As Template end-to-end pass: built-in templates are seeded into
 * the library's Templates folder on first open, a note can be saved as a
 * template (keeping or discarding the original), and a name collision
 * asks before replacing. Templates open in reading mode like any note.
 *
 * Seeding uses the app's own first-open path, not a test hook: the
 * seeded library has no settings file and no Templates folder, so the
 * app seeds the built-ins itself when it opens the library.
 */

async function launchSeededApp(options?: { trashable?: boolean }): Promise<{
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}> {
  // Discarding a note moves it to the Recycle Bin, and trashing refuses
  // some mounts (a tmpfs /tmp): a test that discards seeds under the
  // home directory, where trashing works, instead of the temp dir.
  const baseDir = options?.trashable
    ? mkdtempSync(path.join(homedir(), 'a11y-e2e-templates-'))
    : undefined;
  const paths = seedLibrary(
    [
      {
        name: 'Work',
        files: [
          { name: 'Weekly review.md', content: '# Weekly review\n\nWhat went well this week.\n' },
          { name: 'Draft.md', content: '# Draft\n\nA short draft note.\n' },
        ],
      },
    ],
    baseDir,
  );
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  // The first-run tour only opens once the library switch finishes, so
  // wait for the Notebooks grid to show the seeded notebook (the
  // library-open gate) and dismiss the tour before touching the grid:
  // its modal makes the rest of the shell inert.
  await expect(page.getByRole('gridcell', { name: 'Work' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

async function openNote(page: Page, notebook: string, note: string): Promise<void> {
  await openNotebook(page, notebook);
  await openGridEntry(page, note);
}

test('built-ins are seeded into the Templates folder and listed for new notes', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp();
  try {
    // Seeding runs just after the first open; the Templates notebook
    // appears once the five built-in copies land.
    await expect(page.getByRole('gridcell', { name: 'Templates' })).toBeVisible({ timeout: 30000 });
    await openNotebook(page, 'Templates');
    for (const name of ['Daily.md', 'Meeting.md', 'Project.md', 'Reading.md', 'Lecture.md']) {
      await expect(page.getByRole('gridcell', { name })).toBeVisible({ timeout: 30000 });
    }

    // The New note from template dialog lists the Templates folder
    // contents: the seeded built-ins, and nothing else.
    await runPaletteCommand(page, 'New note from template');
    const dialog = page.getByRole('dialog', { name: 'New note from template' });
    await expect(dialog).toBeVisible();
    const options = await dialog
      .getByRole('combobox', { name: 'Template' })
      .evaluate((select: HTMLSelectElement) => Array.from(select.options).map((option) => option.text));
    expect(options).toHaveLength(5);
    expect(options).toEqual(expect.arrayContaining(['Daily', 'Meeting', 'Project', 'Reading', 'Lecture']));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    // A template opens in reading mode like any other note: its content
    // renders, and there is no Markdown source editor.
    await openGridEntry(page, 'Daily.md');
    await expect(page.getByRole('heading', { name: 'Priorities', level: 2 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('seeding retries a template when its first copy fails', async () => {
  // A transient copy failure — the locked-file refusal a slow Windows
  // runner hits — used to abort the whole seed: the first template
  // failed, the rest never landed, and a stale error sat in the status
  // line. Seeding now retries across passes, so one failed copy must
  // not lose any template.
  //
  // The failure is injected in the main process, by refusing the first
  // staging write once: a copied note is written to a `.import-` staging
  // file first, so one refused staging write fails exactly one copy
  // with a lock error, the same shape as the Windows refusal that
  // blocked the release. A renderer-side wrapper cannot do this: the
  // preload bridge is frozen by the context bridge, so replacing its
  // createNote silently does nothing. The library only opens when the
  // test opens it from the picker below, so the patch is in place
  // before any copy can happen. The patch records whether it fired, so
  // a missed injection fails loudly instead of passing without
  // exercising the retry.
  const paths = seedLibrary([
    {
      name: 'Work',
      files: [{ name: 'Weekly review.md', content: '# Weekly review\n\nWhat went well this week.\n' }],
    },
  ]);
  const recentFile = path.join(paths.userDataDir, 'recent-vault.json');
  const recent = JSON.parse(readFileSync(recentFile, 'utf8')) as { recent: unknown };
  writeFileSync(recentFile, JSON.stringify({ recent: recent.recent }, null, 2), 'utf8');
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  try {
    await waitForApp(page);
    // Nothing is open yet: the Libraries picker is showing.
    await expect(page.getByRole('heading', { name: 'Libraries', level: 2, exact: true })).toBeVisible({
      timeout: 30000,
    });
    await app.evaluate(() => {
      const proc = globalThis.process as unknown as {
        mainModule?: { require?: (id: string) => Record<string, unknown> };
      };
      const target = proc.mainModule?.require?.('node:fs/promises') as unknown as {
        writeFile: (...args: unknown[]) => Promise<unknown>;
      };
      const original = target.writeFile;
      let failedOnce = false;
      target.writeFile = (async (...args: unknown[]) => {
        const filePath = args[0];
        if (!failedOnce && typeof filePath === 'string' && filePath.includes('.import-')) {
          failedOnce = true;
          (globalThis as unknown as { __seedWriteStubThrew?: boolean }).__seedWriteStubThrew = true;
          const error = new Error('Simulated transient staging write failure') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        }
        return original(...args);
      }) as typeof target.writeFile;
    });
    // The tutorial opens on first launch and makes the shell inert, so
    // dismiss it before touching the picker.
    await dismissTutorial(page);
    // Open the recent library from the picker: double-clicking its row opens it.
    await page.getByRole('gridcell', { name: 'library', exact: true }).dblclick();
    await expect(page.getByRole('gridcell', { name: 'Work' })).toBeVisible({ timeout: 30000 });

    // The retry lands Daily on a later pass: all five built-ins appear.
    await expect(page.getByRole('gridcell', { name: 'Templates' })).toBeVisible({ timeout: 30000 });
    await openNotebook(page, 'Templates');
    for (const name of ['Daily.md', 'Meeting.md', 'Project.md', 'Reading.md', 'Lecture.md']) {
      await expect(page.getByRole('gridcell', { name })).toBeVisible({ timeout: 30000 });
    }
    // The patch really fired, and the failure reached the seeding
    // retry: without the injected failure this test would pass without
    // exercising the retry at all.
    expect(
      await app.evaluate(() => (globalThis as unknown as { __seedWriteStubThrew?: boolean }).__seedWriteStubThrew),
    ).toBe(true);
    expect(consoleErrors.some((text) => text.includes('Template seeding failed for Daily'))).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Save As Template copies the note and keeps the original open', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp();
  try {
    await openNote(page, 'Work', 'Weekly review.md');
    await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    await pressShortcut(page, 'Control+Shift+S');
    const dialog = page.getByRole('dialog', { name: 'Save note as template' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByRole('textbox', { name: 'Template name' })).toHaveValue('Weekly review');
    await expect(dialog.getByRole('radio', { name: 'Keep the original note' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Save as template' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(statusLine(page)).toContainText('Saved Weekly review as a template.', { timeout: 30000 });

    // The template holds the note's content, and the original is still there.
    await pressShortcut(page, 'Control+2');
    await openNotebook(page, 'Templates');
    await openGridEntry(page, 'Weekly review.md');
    await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    await pressShortcut(page, 'Control+2');
    await openNotebook(page, 'Work');
    await expect(page.getByRole('gridcell', { name: 'Weekly review.md' })).toBeVisible({ timeout: 30000 });

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Save As Template discards the original note when asked', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp({ trashable: true });
  try {
    // Discarding goes through the app's delete, which shows a native
    // Recycle Bin confirmation (dialog.showMessageBox) that Playwright
    // cannot click and that blocks the IPC handler until answered. Stub
    // it to auto-confirm ("Delete", response 0) — the same technique
    // nesting-verify.spec.ts uses for the Move confirmation.
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await openNote(page, 'Work', 'Draft.md');
    await expect(page.getByRole('heading', { name: 'Draft', level: 1 })).toBeVisible({ timeout: 30000 });
    await pressShortcut(page, 'Control+Shift+S');
    const dialog = page.getByRole('dialog', { name: 'Save note as template' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByRole('radio', { name: 'Discard the original note' }).click();
    await dialog.getByRole('button', { name: 'Save as template' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(statusLine(page)).toContainText('Saved Draft as a template and discarded the original note.', {
      timeout: 30000,
    });

    await pressShortcut(page, 'Control+2');
    await openNotebook(page, 'Templates');
    await expect(page.getByRole('gridcell', { name: 'Draft.md' })).toBeVisible({ timeout: 30000 });
    await pressShortcut(page, 'Control+2');
    await openNotebook(page, 'Work');
    await expect(page.getByRole('gridcell', { name: 'Draft.md' })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Save As Template asks before replacing an existing template', async () => {
  const { app, page, paths, pageErrors } = await launchSeededApp();
  try {
    await openNote(page, 'Work', 'Weekly review.md');
    await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible({
      timeout: 30000,
    });
    await pressShortcut(page, 'Control+Shift+S');
    const dialog = page.getByRole('dialog', { name: 'Save note as template' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByRole('button', { name: 'Save as template' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(statusLine(page)).toContainText('Saved Weekly review as a template.', { timeout: 30000 });

    // Saving the same name again asks first instead of overwriting: the
    // dialog stays open on the replace question.
    await pressShortcut(page, 'Control+Shift+S');
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByRole('button', { name: 'Save as template' }).click();
    await expect(dialog.getByText('A template named “Weekly review” already exists.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Replace template' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace template' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(statusLine(page)).toContainText('Saved Weekly review as a template.', { timeout: 30000 });

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
