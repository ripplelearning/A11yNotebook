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
 * to retry or grant permission. In this Electron version getUserMedia
 * does not consult the main-process permission handlers, so the denial
 * Tristen saw came from the operating system's microphone privacy
 * setting — not from the app. The fix is the experience, not the
 * handler: a denied microphone now opens an announced dialog that
 * explains how to allow it (Windows Settings → Privacy & security →
 * Microphone) and offers Retry (microphone only, no model choice
 * again) and Cancel, instead of a dead-end status line. F9 mutes and
 * unmutes the microphone while a session is active.
 *
 * The denied-microphone test stubs getUserMedia in the live renderer
 * page to reject with NotAllowedError, because no Electron permission
 * mechanism denies the microphone in E2E (the session handlers are
 * not consulted for getUserMedia here, and the flags do not deny it).
 * The stub drives the app's real denial path: startDictation →
 * recorder → dialog → Retry re-runs the microphone request.
 *
 * The F9 test runs first: it pays the cold Vite compile, so the second
 * test starts against a warm dev server. Dictation state is asserted
 * through the status line, not the Dictate button — the button hides
 * unless command buttons are turned on in Settings, while the
 * Alt+Ctrl+D shortcut works either way.
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

test('denied microphone shows the blocked dialog with Retry, and Alt+Ctrl+D retries', async () => {
  const paths = seed();
  const { app, page } = await launchApp(paths.userDataDir);
  try {
    await waitForApp(page);
    await dismissTutorial(page);
    // Stub the microphone in the live page so getUserMedia rejects
    // exactly as a blocked microphone does (NotAllowedError), and
    // count the calls so Retry can be shown to re-run the request.
    await page.evaluate(() => {
      (window as unknown as { __gumCalls: number }).__gumCalls = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        (window as unknown as { __gumCalls: number }).__gumCalls += 1;
        throw new DOMException('Permission denied', 'NotAllowedError');
      };
    });
    const gumCalls = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls);
    await openNoteInEditMode(page);

    await pressShortcut(page, 'Control+Alt+D');
    await chooseModel(page);
    const blocked = page.getByRole('alertdialog', { name: 'Microphone is blocked' });
    await expect(blocked).toBeVisible({ timeout: 15000 });
    await expect(blocked.getByText(/cannot use the microphone/)).toBeVisible();
    expect(await gumCalls()).toBe(1);

    // Retry tries the microphone again (still denied) — the dialog stays.
    await blocked.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Microphone is blocked' })).toBeVisible();
    expect(await gumCalls()).toBe(2);

    // Cancel closes it; Alt+Ctrl+D again goes straight back to the
    // blocked dialog — the model is already chosen, so no model
    // dialog appears a second time.
    await blocked.getByRole('button', { name: 'Cancel' }).click();
    await expect(blocked).toHaveCount(0);
    await pressShortcut(page, 'Control+Alt+D');
    await expect(page.getByRole('alertdialog', { name: 'Microphone is blocked' })).toBeVisible({
      timeout: 15000,
    });
    expect(await gumCalls()).toBe(3);
  } finally {
    await closeApp(app, paths);
  }
});
