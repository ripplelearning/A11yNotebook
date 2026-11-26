import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openNotebook,
  runPaletteCommand,
  seedLibrary,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Regression test for Tristen's 1.9.25 retest finding: she edited the
 * built-in Project template, and it vanished from the "New note from
 * template" picker while still showing in the Templates notebook.
 *
 * The picker only listed Templates-folder notes whose hidden origin
 * (provenance) record said app-created/imported/task. A cloud-sync
 * replacement gives the file a new identity, so the record no longer
 * matches and the note is no longer "managed" — even though the file
 * is still in the Templates folder. The same bug class hid notes from
 * the Create Task list until #259 dropped the origin requirement
 * there. A template is a template because it is a file in the
 * Templates folder, so the picker must not require the record.
 *
 * Seeding mirrors #259's helper: the library is seeded with a Project
 * template, then the provenance sidecar is wiped the way a sync
 * replacement leaves it. The app re-records provenance for the
 * built-ins it seeds itself on first open, but nothing re-records the
 * replaced Project file.
 */
function seedLibraryWithProvenanceLostTemplate(): SeedPaths {
  const paths = seedLibrary([
    {
      name: 'Work',
      files: [{ name: 'Guide.md', content: '# Guide\n\nWork guide.\n' }],
    },
    {
      name: 'Templates',
      files: [
        {
          name: 'Project.md',
          content:
            '# Project\n\n## Goal\n\n{{Goal}}\n\n## Milestones\n\n{{Milestones}}\n\n## Resources\n\n{{Resources}}\n',
        },
      ],
    },
  ]);
  writeFileSync(
    path.join(paths.libraryDir, '.a11ynotebook', 'provenance.json'),
    JSON.stringify({ version: 1, records: {} }, null, 2),
    'utf8',
  );
  return paths;
}

async function launchSeededApp(): Promise<{
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
}> {
  const paths = seedLibraryWithProvenanceLostTemplate();
  const { app, page } = await launchApp(paths.userDataDir);
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Templates' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  return { app, page, paths };
}

test('a template without a provenance record still appears in the new-note-from-template picker', async () => {
  const { app, page, paths } = await launchSeededApp();
  try {
    // The Project template still shows in the Templates notebook...
    await openNotebook(page, 'Templates');
    for (const name of ['Daily.md', 'Meeting.md', 'Project.md', 'Reading.md', 'Lecture.md']) {
      await expect(page.getByRole('gridcell', { name })).toBeVisible({ timeout: 30000 });
    }

    // ...and it must also be listed when creating a note from a template.
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
  } finally {
    await closeApp(app, paths);
  }
});
