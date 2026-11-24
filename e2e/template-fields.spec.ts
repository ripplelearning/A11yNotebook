import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  platformShortcut,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Fillable {{Name}} template fields end to end:
 * - filling a note made from a template and saving bakes the values
 *   into the note text (plain filled text, markers gone);
 * - the filled note's reading view offers a fresh fillable copy from
 *   its source template;
 * - filling a template note itself never changes the template: saving
 *   offers a filled copy with format, location, and name prompts;
 * - a filled note whose source template is gone says so on its button;
 * - a note created from a seeded built-in template (Meeting) records a
 *   link to it and offers a working fresh fillable copy.
 *
 * Rename-follow for the source-template link is covered at the store
 * level (template-links-store.test.ts: migratePaths retargets both the
 * filled note's path and the template's path) and wired into the same
 * rename/move flow as the other per-note sidecars; there is no
 * scriptable rename shortcut to drive it through the UI here.
 */

const TEMPLATE_CONTENT = '# {{title}}\n\nClient: {{Client Name}}\nProject: {{Project}}\n\nNotes:\n';

function seed(): SeedPaths {
  const paths = seedLibrary([
    { name: 'Templates', files: [{ name: 'Intake.md', content: TEMPLATE_CONTENT }] },
    {
      name: 'Notes',
      files: [
        {
          name: 'Old intake.md',
          content: '# Old intake\n\nClient: Ada Lovelace\n',
        },
      ],
    },
  ]);
  // A filled note whose source template is gone: the button must say so.
  writeFileSync(
    path.join(paths.libraryDir, '.a11ynotebook', 'template-links.json'),
    JSON.stringify(
      {
        version: 1,
        records: [
          {
            path: 'Notes/Old intake.md',
            templatePath: 'Templates/Gone.md',
            updatedAt: new Date().toISOString(),
            schemaVersion: 1,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  return paths;
}

async function openNotebook(page: Awaited<ReturnType<typeof launchApp>>['page'], name: string) {
  await expect(page.getByRole('gridcell', { name })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await page.getByRole('row', { name: new RegExp(`${name}\\s+notebook`) }).dblclick();
}

async function openNote(page: Awaited<ReturnType<typeof launchApp>>['page'], fileName: string) {
  const noteCell = page.getByRole('gridcell', { name: fileName });
  await expect(noteCell).toBeVisible({ timeout: 30000 });
  await noteCell.dblclick();
}

test('filling a note from a template bakes values on save and offers a fresh copy', async () => {
  let app: ElectronApplication | null = null;
  const paths = seed();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);

    await openNotebook(page, 'Templates');
    await openNote(page, 'Intake.md');
    // The template itself opens in reading mode, with its fields fillable.
    await expect(page.getByRole('textbox', { name: 'Client Name' })).toBeVisible();

    // Create a note from the library template, into Notes.
    await page.keyboard.press(platformShortcut('Control+Shift+N'));
    const dialog = page.getByRole('dialog', { name: 'New note from template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Template').selectOption('user:Templates/Intake.md');
    await dialog.getByLabel('Notebook').selectOption('Notes');
    await dialog.getByLabel('Note title').fill('Intake one');
    await dialog.getByRole('button', { name: 'Create note' }).click();
    await expect(dialog).toHaveCount(0);

    // The new note opens in editing mode; switch to reading mode to fill.
    await page.keyboard.press(platformShortcut('Control+E'));
    const clientField = page.getByRole('textbox', { name: 'Client Name' });
    await expect(clientField).toBeVisible();
    await clientField.fill('Ada Lovelace');
    await page.getByRole('textbox', { name: 'Project' }).fill('Apollo');

    await page.keyboard.press(platformShortcut('Control+S'));
    await expect(statusLine(page)).toHaveText('Saved Intake one.', { timeout: 10000 });

    const saved = readFileSync(path.join(paths.libraryDir, 'Notes', 'Intake one.md'), 'utf8');
    expect(saved).toContain('Client: Ada Lovelace');
    expect(saved).toContain('Project: Apollo');
    expect(saved).not.toContain('{{Client Name}}');
    expect(saved).not.toContain('{{Project}}');
    expect(readFileSync(path.join(paths.libraryDir, 'Templates', 'Intake.md'), 'utf8')).toContain('{{Client Name}}');

    // The filled note offers a fresh fillable copy from its template.
    const freshCopy = page.getByRole('button', { name: 'New fillable copy from this template' });
    await expect(freshCopy).toBeVisible();
    await freshCopy.click();
    await expect(page.getByRole('textbox', { name: 'Client Name' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Client Name' })).toHaveValue('');
    const copy = readFileSync(path.join(paths.libraryDir, 'Notes', 'Intake one (copy).md'), 'utf8');
    expect(copy).toContain('{{Client Name}}');

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('filling a template note offers a filled copy and leaves the template unchanged', async () => {
  let app: ElectronApplication | null = null;
  const paths = seed();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);

    await openNotebook(page, 'Templates');
    await openNote(page, 'Intake.md');
    // The template itself opens in reading mode, with its fields fillable.
    await expect(page.getByRole('textbox', { name: 'Client Name' })).toBeVisible();

    const clientField = page.getByRole('textbox', { name: 'Client Name' });
    await expect(clientField).toBeVisible();
    await clientField.fill('Grace Hopper');
    await page.getByRole('textbox', { name: 'Project' }).fill('Beacon');

    await page.keyboard.press(platformShortcut('Control+S'));
    const dialog = page.getByRole('dialog', { name: 'Save filled copy' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Save in').selectOption('Notes');
    await dialog.getByLabel('Note name').fill('Intake filled');
    await dialog.getByRole('button', { name: 'Save filled copy' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(statusLine(page)).toHaveText('Filled copy saved.', { timeout: 10000 });

    const copy = readFileSync(path.join(paths.libraryDir, 'Notes', 'Intake filled.md'), 'utf8');
    expect(copy).toContain('Client: Grace Hopper');
    expect(copy).toContain('Project: Beacon');
    expect(copy).not.toContain('{{Client Name}}');
    // The template itself is untouched.
    expect(readFileSync(path.join(paths.libraryDir, 'Templates', 'Intake.md'), 'utf8')).toBe(TEMPLATE_CONTENT);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a filled note whose source template is gone says so on its button', async () => {
  let app: ElectronApplication | null = null;
  const paths = seed();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);

    await openNotebook(page, 'Notes');
    await openNote(page, 'Old intake.md');
    await expect(page.getByRole('heading', { name: 'Old intake', level: 1 })).toBeVisible();
    const gone = page.getByRole('button', { name: 'Source template no longer in this library' });
    await expect(gone).toBeVisible();
    await expect(gone).toBeDisabled();

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a note created from a seeded built-in template records a link and offers a fresh copy', async () => {
  let app: ElectronApplication | null = null;
  // No Templates folder and no settings file: the app seeds the
  // built-ins itself on first open, so Meeting arrives as a real file
  // in Templates/ and must record a link like any user template.
  const paths = seedLibrary([
    { name: 'Notes', files: [{ name: 'Scratch.md', content: '# Scratch\n' }] },
  ]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);

    // Seeding runs just after the first open; the Templates notebook
    // appears once the five built-in copies land.
    await expect(page.getByRole('gridcell', { name: 'Templates' })).toBeVisible({ timeout: 30000 });
    await dismissTutorial(page);

    await openNotebook(page, 'Notes');
    await page.keyboard.press(platformShortcut('Control+Shift+N'));
    const dialog = page.getByRole('dialog', { name: 'New note from template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Template').selectOption('user:Templates/Meeting.md');
    await dialog.getByLabel('Notebook').selectOption('Notes');
    await dialog.getByLabel('Note title').fill('Team sync');
    await dialog.getByRole('button', { name: 'Create note' }).click();
    await expect(dialog).toHaveCount(0);

    // The new note opens in editing mode; switch to reading mode, where
    // the fresh-copy button lives.
    await page.keyboard.press(platformShortcut('Control+E'));
    const freshCopy = page.getByRole('button', { name: 'New fillable copy from this template' });
    await expect(freshCopy).toBeVisible();

    // The link is recorded on disk, pointing at the seeded built-in.
    const links = JSON.parse(
      readFileSync(path.join(paths.libraryDir, '.a11ynotebook', 'template-links.json'), 'utf8'),
    ) as { records: { path: string; templatePath: string }[] };
    expect(links.records).toContainEqual(
      expect.objectContaining({ path: 'Notes/Team sync.md', templatePath: 'Templates/Meeting.md' }),
    );

    // The button works: a fresh copy of the seeded template is created.
    await freshCopy.click();
    await expect(statusLine(page)).toHaveText('Created a fresh fillable copy from Meeting.md.', {
      timeout: 10000,
    });
    expect(readFileSync(path.join(paths.libraryDir, 'Notes', 'Team sync (copy).md'), 'utf8')).toContain(
      '## Agenda',
    );

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
