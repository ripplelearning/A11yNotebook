import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { closeApp, dismissTutorial, launchApp, pressShortcut, seedLibrary, waitForApp } from './helpers';

/**
 * New note from template dialog (Ctrl+Shift+N): keyboard focus must
 * start in the Template combobox, so a screen-reader user lands on the
 * first choice the dialog asks for instead of the Note title field.
 */

test('focus starts in the Template combobox when the dialog opens', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([
    { name: 'Templates', files: [{ name: 'Intake.md', content: '# Intake\n' }] },
    { name: 'Notes', files: [{ name: 'Existing.md', content: '# Existing\n' }] },
  ]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await dismissTutorial(page);

    // The command needs a notebook selected first.
    await expect(page.getByRole('gridcell', { name: 'Notes' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('row', { name: /Notes\s+notebook/ }).dblclick();

    await pressShortcut(page, 'Control+Shift+N');
    const dialog = page.getByRole('dialog', { name: 'New note from template' });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByLabel('Template')).toBeFocused();
    await expect(dialog.getByLabel('Note title')).not.toBeFocused();

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
