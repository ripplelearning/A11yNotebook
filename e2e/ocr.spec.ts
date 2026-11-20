import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  pressShortcut,
  seedLibrary,
  waitForApp,
  type SeedPaths,
} from './helpers';

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureBytes(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, name));
}

async function openSeededFile(page: Awaited<ReturnType<typeof launchApp>>['page'], fileName: string) {
  await expect(page.getByRole('gridcell', { name: 'OCR' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await page.getByRole('row', { name: /OCR\s+notebook/ }).dblclick();
  const cell = page.getByRole('gridcell', { name: fileName });
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.dblclick();
  await expect(page.getByRole('button', { name: 'OCR this file' }).first()).toBeVisible({
    timeout: 30000,
  });
}

async function runOcr(page: Awaited<ReturnType<typeof launchApp>>['page']) {
  const dialog = page.getByRole('dialog', { name: 'OCR this file' });
  await page.getByRole('button', { name: 'OCR this file' }).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /English/ }).click();
  await dialog.getByRole('button', { name: 'Start OCR' }).click();
  return dialog;
}

test('OCR a scanned PDF: text shows temporarily, then Ctrl+S saves it into the file', async () => {
  const paths = seedLibrary([
    {
      name: 'OCR',
      files: [{ name: 'ocr-image-only.pdf', content: fixtureBytes('ocr-image-only.pdf') }],
    },
  ]);
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(paths.userDataDir));
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await openSeededFile(page, 'ocr-image-only.pdf');

    const dialog = await runOcr(page);
    // The real on-device engine reads the fixture word; a whole file can
    // take a while on first run (worker + language data load).
    await expect(page.getByText('HELLO').first()).toBeVisible({ timeout: 60000 });
    await dialog.getByRole('button', { name: 'Keep temporary in reader' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/Recognized text \(temporary\)/)).toBeVisible();

    await pressShortcut(page, 'Control+S');
    await expect(page.getByText('OCR text saved into the file.')).toBeVisible({ timeout: 30000 });
    // After the reload the text is real page text, not temporary OCR text.
    await expect(page.getByText(/Recognized text \(temporary\)/)).toHaveCount(0);
    await expect(page.getByText('HELLO').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('OCR a scanned ePub: text shows temporarily in the reader', async () => {
  const paths = seedLibrary([
    {
      name: 'OCR',
      files: [{ name: 'ocr-image-only.epub', content: fixtureBytes('ocr-image-only.epub') }],
    },
  ]);
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(paths.userDataDir));
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await openSeededFile(page, 'ocr-image-only.epub');

    await runOcr(page);
    await expect(page.getByText('HELLO').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/Recognized text \(temporary\)/)).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('OCR can be cancelled mid-run and keeps no text', async () => {
  const paths = seedLibrary([
    {
      name: 'OCR',
      files: [{ name: 'ocr-image-only-long.pdf', content: fixtureBytes('ocr-image-only-long.pdf') }],
    },
  ]);
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(paths.userDataDir));
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await openSeededFile(page, 'ocr-image-only-long.pdf');

    const dialog = await runOcr(page);
    await expect(dialog.getByRole('progressbar', { name: 'OCR progress' })).toBeVisible({
      timeout: 60000,
    });
    await dialog.getByRole('button', { name: 'Cancel OCR' }).click();
    await expect(dialog.getByText('OCR cancelled. No text was saved.')).toBeVisible({
      timeout: 30000,
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('OCR on an Alius saves a copy in the library and never touches the original', async () => {
  const paths: SeedPaths = seedLibrary([{ name: 'OCR', files: [] }]);
  // The Alius target lives outside the library; the .alius record inside it
  // points at the original file.
  const outsidePath = path.join(paths.baseDir, 'outside-original.pdf');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outsidePath, fixtureBytes('ocr-image-only.pdf'));
  const beforeHash = createHash('sha256').update(readFileSync(outsidePath)).digest('hex');
  writeFileSync(
    path.join(paths.libraryDir, 'OCR', 'ocr-image-only.pdf.alius'),
    JSON.stringify({ version: 1, target: outsidePath }),
    'utf8',
  );
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(paths.userDataDir));
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await openSeededFile(page, 'ocr-image-only.pdf.alius');

    await runOcr(page);
    await expect(page.getByText('HELLO').first()).toBeVisible({ timeout: 60000 });
    await page
      .getByRole('dialog', { name: 'OCR this file' })
      .getByRole('button', { name: 'Keep temporary in reader' })
      .click();
    await pressShortcut(page, 'Control+S');
    await expect(
      page.getByText('Saved OCR copy as ocr-image-only (OCR).pdf. The original file was not changed.'),
    ).toBeVisible({ timeout: 30000 });
    // The temporary text stays: the open file was not changed.
    await expect(page.getByText(/Recognized text \(temporary\)/)).toBeVisible();
    // The original on disk is byte-identical; the copy exists in the library.
    expect(createHash('sha256').update(readFileSync(outsidePath)).digest('hex')).toBe(beforeHash);
    expect(readdirSync(path.join(paths.libraryDir, 'OCR'))).toContain('ocr-image-only (OCR).pdf');
    expect(statSync(path.join(paths.libraryDir, 'OCR', 'ocr-image-only (OCR).pdf')).size).toBeGreaterThan(
      statSync(outsidePath).size,
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
