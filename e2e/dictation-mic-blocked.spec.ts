import { test, expect } from '@playwright/test';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  pressShortcut,
  seedLibrary,
  statusLine,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Dictation microphone (1.9.25 retest): pressing Alt+Ctrl+D, choosing a
 * model, and getting "Dictation stopped: Permission denied" with no way
 * to retry or grant permission. The app itself was denying every
 * microphone request in the main process, so the failure was not the
 * user's settings at all — and the only feedback was a status line.
 * The blocked-microphone dialog now explains how to allow the mic and
 * offers Retry (microphone only, no model choice again) and Cancel.
 * F9 mutes and unmutes the microphone while a session is active.
 */

const NOTE_CONTENT = '# Field Notes\n\nIntro paragraph at the top of the note.\n';

function seed(): SeedPaths {
  return seedLibrary([{ name: 'Seeded', files: [{ name: 'Field Notes.md', content: NOTE_CONTENT }] }]);
}

async function openNoteInEditMode(page: import('@playwright/test').Page): Promise<void> {
  await openNotebook(page, 'Seeded');
  await openGridEntry(page, 'Field Notes.md');
  await expect(page.getByRole('heading', { name: 'Field Notes', level: 1 })).toBeVisible({ timeout: 30000 });
  await pressShortcut(page, 'Control+E');
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeFocused();
}

async function chooseModel(page: import('@playwright/test').Page): Promise<void> {
  const modelDialog = page.getByRole('dialog', { name: 'Choose a transcription model' });
  await expect(modelDialog).toBeVisible();
  await modelDialog.getByRole('button', { name: 'Download model' }).click();
}

test('denied microphone shows the blocked dialog with Retry, and Alt+Ctrl+D retries', async () => {
  const paths = seed();
  const { app, page } = await launchApp(paths.userDataDir);
  try {
    // Deny every permission request in the main process: the same
    // denial the app used to ship with, so getUserMedia rejects with
    // "Permission denied" exactly as Tristen saw it.
    await app.evaluate(async ({ session }) => {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
    });
    await waitForApp(page);
    await dismissTutorial(page);
    await openNoteInEditMode(page);

    await pressShortcut(page, 'Control+Alt+D');
    await chooseModel(page);
    const blocked = page.getByRole('alertdialog', { name: 'Microphone is blocked' });
    await expect(blocked).toBeVisible({ timeout: 15000 });
    await expect(blocked.getByText(/cannot use the microphone/)).toBeVisible();

    // Retry tries the microphone again (still denied) — the dialog stays.
    await blocked.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Microphone is blocked' })).toBeVisible();

    // Cancel closes it; Alt+Ctrl+D again goes straight back to the
    // blocked dialog — the model is already chosen, so no model
    // dialog appears a second time.
    await blocked.getByRole('button', { name: 'Cancel' }).click();
    await expect(blocked).toHaveCount(0);
    await pressShortcut(page, 'Control+Alt+D');
    await expect(page.getByRole('alertdialog', { name: 'Microphone is blocked' })).toBeVisible({
      timeout: 15000,
    });
  } finally {
    await closeApp(app, paths);
  }
});

test('F9 mutes and unmutes the microphone during dictation', async () => {
  const paths = seed();
  const { app, page } = await launchApp(paths.userDataDir, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ]);
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    await openNoteInEditMode(page);

    await pressShortcut(page, 'Control+Alt+D');
    await chooseModel(page);
    await expect(page.getByRole('button', { name: 'Stop dictation' })).toBeVisible({ timeout: 15000 });
    await expect(statusLine(page)).toContainText('Dictating.');

    await pressShortcut(page, 'F9');
    await expect(statusLine(page)).toContainText('Microphone off.');
    await pressShortcut(page, 'F9');
    await expect(statusLine(page)).toContainText('Microphone on.');

    // Closing the note ends the session and drops the recording, so no
    // transcription (and no model download) starts in this test.
    await pressShortcut(page, 'Control+W');
    await expect(statusLine(page)).toContainText(
      'Dictation stopped. The note was closed, so the recording was not saved.',
    );
  } finally {
    await closeApp(app, paths);
  }
});
