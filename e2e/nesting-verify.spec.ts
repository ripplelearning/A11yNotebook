import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openNotebook,
  pressShortcut,
  runPaletteCommand,
  seedLibrary,
  statusLine,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Regression scenarios for the 1.9.20 retest item: new-notebook
 * auto-nesting / note-in-two-notebooks, and the Move path for the old
 * case (a notebook nested inside another moved out to the Library root).
 *
 * The move test also covers the stale-path race it used to expose: the
 * open note's path was remapped only after an async re-read, so in the
 * window between the new vault landing and the remap the annotations
 * load rejected with ENOENT and "Could not load annotations." overwrote
 * "Staged changes applied." — the status must still read "Staged changes
 * applied." (App.tsx remaps open-note paths synchronously in
 * applyOrganizeResult / submitItem now).
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchNestingApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([{ name: 'Archive', files: [{ name: 'Guide.md', content: '# Guide\n\nArchive guide.\n' }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

async function showNotebooks(page: Page): Promise<void> {
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
}

async function createNote(page: Page, name: string, content: string): Promise<void> {
  await runPaletteCommand(page, 'New note');
  const noteDialog = page.getByRole('dialog', { name: 'New note' });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel('New Note Name').fill(name);
  await noteDialog.getByRole('button', { name: 'New note', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown source' });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toBeFocused();
  await editor.fill(content);
  await pressShortcut(page, 'Control+S');
  await expect(statusLine(page)).toContainText(`Saved ${name}.`, { timeout: 30000 });
  await pressShortcut(page, 'Control+E');
  await expect(statusLine(page)).toContainText('Mode switched to read-only.', { timeout: 30000 });
}

test('Notebooks tab Ctrl+N shows the Location picker, defaults to Library root', async () => {
  const { app, page, paths, pageErrors } = await launchNestingApp();
  try {
    await openNotebook(page, 'Archive');
    await showNotebooks(page);
    // The Notebooks-tab creation path: Ctrl+N ("New in current view") in
    // the Notebooks view — the tab itself has no New-notebook button; the
    // navigation-pane button is hidden unless command buttons are enabled
    // (settings.showCommandButtons defaults to false).
    await pressShortcut(page, 'Control+N');
    const dialog = page.getByRole('dialog', { name: 'New notebook' });
    await expect(dialog).toBeVisible();
    const location = dialog.getByLabel('Location');
    await expect(location).toHaveValue('');
    await expect(location.locator('option', { hasText: 'Library root' })).toHaveCount(1);
    await expect(location.locator('option', { hasText: 'Inside Archive' })).toHaveCount(1);
    await dialog.getByLabel('New Notebook Name').fill('Tab Notebook');
    await dialog.getByRole('button', { name: 'New notebook', exact: true }).click();
    await expect(statusLine(page)).toContainText('Notebook created in the Library root.', { timeout: 30000 });

    // It must not be nested under Archive.
    await showNotebooks(page);
    await openNotebook(page, 'Archive');
    await expect(page.getByRole('gridcell', { name: 'Guide.md' })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'Tab Notebook' })).toHaveCount(0);
    await showNotebooks(page);
    await openNotebook(page, 'Tab Notebook');
    await expect(page.getByRole('gridcell', { name: 'Guide.md' })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Move dialog moves a nested notebook out to the Library root', async () => {
  const { app, page, paths, pageErrors } = await launchNestingApp();
  try {
    // Every vault:move goes through relocate(), which shows a native
    // confirmation dialog (dialog.showMessageBox) that Playwright cannot
    // click and that blocks the IPC handler until answered. Stub it to
    // auto-confirm ("Move and repair links", response 0) — the same
    // technique verification.spec.ts uses for the Import file dialog.
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await openNotebook(page, 'Archive');
    // Create the old-case shape: a notebook nested inside Archive, with a note in it.
    await runPaletteCommand(page, 'New notebook');
    const nestedDialog = page.getByRole('dialog', { name: 'New notebook' });
    await expect(nestedDialog).toBeVisible();
    await nestedDialog.getByLabel('Location').selectOption('Archive');
    await nestedDialog.getByLabel('New Notebook Name').fill('Nested Notes');
    await nestedDialog.getByRole('button', { name: 'New notebook', exact: true }).click();
    await expect(statusLine(page)).toContainText('Notebook created inside Archive.', { timeout: 30000 });
    await createNote(page, 'Nested note', '# Nested note\n\nA note inside a nested notebook.\n');

    // Organize Library -> select the nested notebook -> context menu -> Move.
    await runPaletteCommand(page, 'Organize library');
    const organize = page.getByRole('dialog', { name: 'Organize Library' });
    await expect(organize).toBeVisible();
    const archiveItem = organize.locator('[role="treeitem"][data-path="Archive"]');
    await archiveItem.click();
    await archiveItem.press('ArrowRight');
    const nestedItem = organize.locator('[role="treeitem"][data-path="Archive/Nested Notes"]');
    await expect(nestedItem).toBeVisible();
    await nestedItem.click();
    await nestedItem.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Move to another notebook' }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Move item' });
    await expect(moveDialog).toBeVisible();
    const destination = moveDialog.getByLabel('Destination notebook');
    await expect(destination.locator('option', { hasText: 'Library root' })).toHaveCount(1);
    await expect(destination).toHaveValue('');
    await moveDialog.getByRole('button', { name: 'Move item', exact: true }).click();
    await expect(organize.getByRole('status')).toContainText('Moved Nested Notes into Library root (staged).', {
      timeout: 30000,
    });
    await organize.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(statusLine(page)).toContainText('Staged changes applied.', { timeout: 30000 });

    // The notebook is now at the root: Archive no longer lists it, and
    // its note travels with it.
    await showNotebooks(page);
    await openNotebook(page, 'Archive');
    await expect(page.getByRole('gridcell', { name: 'Guide.md' })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'Nested Notes' })).toHaveCount(0);
    await expect(page.getByRole('gridcell', { name: 'Nested note.md' })).toHaveCount(0);
    await showNotebooks(page);
    await openNotebook(page, 'Nested Notes');
    await expect(page.getByRole('gridcell', { name: 'Nested note.md' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
