import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  canonicalTempDir,
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  seedLibrary,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Fillable PDF end-to-end pass: a fillable form opens with its fields
 * inline in the reflowed reading view, filled values persist in the
 * app, a filled file is produced by the export, and filling an Alius
 * never touches the original.
 *
 * The fixture is generated with pdf-lib, so no third-party file is
 * involved: a text field (tooltip + required), a checkbox, a dropdown,
 * and a radio group, each beside a short label drawn on the page.
 */
async function fillablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Full name:', { x: 50, y: 705, size: 12, font });
  page.drawText('I agree to the terms', { x: 70, y: 655, size: 12, font });
  page.drawText('Favorite color:', { x: 50, y: 605, size: 12, font });
  page.drawText('Size:', { x: 50, y: 555, size: 12, font });
  const form = doc.getForm();
  const name = form.createTextField('fullName');
  name.addToPage(page, { x: 150, y: 700, width: 200, height: 20 });
  name.acroField.getWidgets()[0].dict.set(PDFName.of('TU'), PDFString.of('Your full name'));
  name.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(2));
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 50, y: 650, width: 15, height: 15 });
  const color = form.createDropdown('color');
  color.addOptions(['Red', 'Green', 'Blue']);
  color.addToPage(page, { x: 150, y: 600, width: 150, height: 20 });
  const size = form.createRadioGroup('size');
  size.addOptionToPage('Small', page, { x: 100, y: 550, width: 15, height: 15 });
  size.addOptionToPage('Large', page, { x: 160, y: 550, width: 15, height: 15 });
  return doc.save();
}

async function openFillablePdf(page: Page, notebookName = 'Forms', fileName = 'Application.pdf'): Promise<void> {
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: notebookName })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await openNotebook(page, notebookName);
  await openGridEntry(page, fileName);
  await expect(page.getByRole('heading', { name: 'Form fields' })).toBeVisible({ timeout: 30000 });
}

/**
 * A form with an unfilled rich-text text field, as XFA-era producers
 * ship them: the RichText flag is set, the field holds no value, and
 * its widget has no appearance stream. A plain required field sits
 * beside it so the download can be driven the way Tristen drove it.
 */
async function richTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Full name:', { x: 50, y: 705, size: 12, font });
  const form = doc.getForm();
  const rich = form.createTextField('GM_Name');
  rich.addToPage(page, { x: 150, y: 700, width: 200, height: 20 });
  rich.acroField.getWidgets()[0].dict.set(PDFName.of('TU'), PDFString.of('GM name'));
  // Enable rich formatting only after the widget exists: pdf-lib builds
  // the appearance on addToPage, and reading an empty rich-text field
  // throws. Real producers ship the flag already set, value or not.
  rich.enableRichFormatting();
  const name = form.createTextField('plainName');
  name.addToPage(page, { x: 150, y: 650, width: 200, height: 20 });
  name.acroField.getWidgets()[0].dict.set(PDFName.of('TU'), PDFString.of('Your full name'));
  name.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(2));
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const widget = reloaded.getForm().getTextField('GM_Name').acroField.getWidgets()[0];
  widget.dict.delete(PDFName.of('AP'));
  return reloaded.save({ updateFieldAppearances: false });
}

function formSection(page: Page) {
  return page.getByRole('region', { name: 'Form fields' });
}

test('fillable PDF opens with fields inline and values persist in the app', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([{ name: 'Forms', files: [{ name: 'Application.pdf', content: await fillablePdf() }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openFillablePdf(page);

    // Fields sit inline in the reading view with their labels.
    await expect(page.getByLabel('Your full name (required)')).toBeVisible();
    await expect(page.getByLabel('I agree to the terms')).toBeVisible();
    await expect(page.getByLabel('Favorite color:')).toBeVisible();
    await expect(page.getByLabel('Small', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Large', { exact: true })).toBeVisible();

    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    await page.getByLabel('I agree to the terms').check();
    await page.getByLabel('Favorite color:').selectOption('Green');
    await page.getByLabel('Large', { exact: true }).check();
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });

    // Reopen the PDF: the values are still there, from the app store.
    await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Forms' }).count());
    await openNotebook(page, 'Forms');
    await openGridEntry(page, 'Application.pdf');
    await expect(page.getByRole('heading', { name: 'Form fields' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Your full name (required)')).toHaveValue('Ada Lovelace');
    await expect(page.getByLabel('I agree to the terms')).toBeChecked();
    await expect(page.getByLabel('Favorite color:')).toHaveValue('Green');
    await expect(page.getByLabel('Large', { exact: true })).toBeChecked();

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('required fields block the filled download until filled, then the download holds the values', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([{ name: 'Forms', files: [{ name: 'Application.pdf', content: await fillablePdf() }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openFillablePdf(page);

    // The required name is empty: the export is refused and named.
    await page.getByRole('button', { name: 'Download filled PDF' }).click();
    await expect(formSection(page).getByRole('status')).toContainText('1 required field still empty', {
      timeout: 10000,
    });
    await expect(formSection(page).getByRole('button', { name: /Go to Your full name/ })).toBeVisible();

    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    await page.getByLabel('I agree to the terms').check();
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });

    // Point the native save dialog at a temp file and verify the
    // downloaded PDF carries the filled values.
    const outPath = path.join(paths.baseDir, 'Application (filled).pdf');
    await app.evaluate(async ({ dialog }, filePath: string) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, outPath);
    await page.getByRole('button', { name: 'Download filled PDF' }).click();
    await expect(formSection(page).getByRole('status')).toContainText('Downloaded filled PDF', { timeout: 10000 });
    const downloaded = await PDFDocument.load(readFileSync(outPath));
    const form = downloaded.getForm();
    expect(form.getTextField('fullName').getText()).toBe('Ada Lovelace');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('password-protected fillable PDF asks once, then fills and keeps values in the app', async () => {
  let app: ElectronApplication | null = null;
  // Encrypted with pypdf (user password "test123"); pdf-lib cannot
  // encrypt, so this one fixture ships as a file.
  const protectedPdf = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'fillable-protected.pdf')));
  const paths = seedLibrary([{ name: 'Forms', files: [{ name: 'Locked.pdf', content: protectedPdf }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await waitForApp(page);
    await expect(page.getByRole('gridcell', { name: 'Forms' })).toBeVisible({ timeout: 30000 });
    await dismissTutorial(page);
    await openNotebook(page, 'Forms');
    await openGridEntry(page, 'Locked.pdf');

    // The reader asks for the password instead of failing the open.
    await expect(page.getByRole('heading', { name: 'Password-protected PDF' })).toBeVisible({ timeout: 30000 });
    await page.getByLabel('PDF password').fill('wrong-password');
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await expect(page.getByRole('alert')).toContainText('That password did not open the PDF.', { timeout: 10000 });

    await page.getByLabel('PDF password').fill('test123');
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await expect(page.getByRole('heading', { name: 'Form fields' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Your full name (required)')).toBeVisible();

    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });

    // Move focus out of the text field first: while a text field has
    // focus the app deliberately ignores the Ctrl+number view shortcuts.
    await page.getByLabel('I agree to the terms').check();
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });

    // Reopen in the same session: the password is not asked again.
    await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Forms' }).count());
    await openNotebook(page, 'Forms');
    await openGridEntry(page, 'Locked.pdf');
    await expect(page.getByLabel('Your full name (required)')).toHaveValue('Ada Lovelace');

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('filling an Alius saves a filled copy and never touches the original', async () => {
  let app: ElectronApplication | null = null;
  const baseDir = mkdtempSync(path.join(canonicalTempDir(), 'a11y-e2e-fillable-alius-'));
  const libraryDir = path.join(baseDir, 'library');
  const userDataDir = path.join(baseDir, 'user-data');
  const outsideDir = path.join(baseDir, 'outside');
  mkdirSync(path.join(libraryDir, 'Forms'), { recursive: true });
  mkdirSync(path.join(libraryDir, '.a11ynotebook'), { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const outsidePath = path.join(outsideDir, 'Application.pdf');
  writeFileSync(outsidePath, await fillablePdf());
  writeFileSync(
    path.join(libraryDir, 'Forms', 'Application.pdf.alius'),
    `${JSON.stringify({ version: 1, target: outsidePath })}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(libraryDir, '.a11ynotebook', 'provenance.json'),
    JSON.stringify({ version: 1, records: {} }, null, 2),
    'utf8',
  );
  const now = new Date();
  writeFileSync(
    path.join(userDataDir, 'recent-vault.json'),
    JSON.stringify(
      { lastOpened: libraryDir, recent: [{ path: libraryDir, name: 'library', lastOpenedAt: now.toISOString() }] },
      null,
      2,
    ),
    'utf8',
  );
  const paths: SeedPaths = { libraryDir, userDataDir, baseDir };
  try {
    const launched = await launchApp(userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openFillablePdf(page, 'Forms', 'Application.pdf.alius');

    await expect(formSection(page).getByText('Filling this Alius never changes the original file.')).toBeVisible();
    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });
    await page.getByRole('button', { name: 'Save filled copy in library' }).click();
    await expect(formSection(page).getByRole('status')).toContainText('Saved filled copy as', { timeout: 10000 });

    // The original outside the library still holds no filled values.
    const original = await PDFDocument.load(readFileSync(outsidePath));
    expect(original.getForm().getTextField('fullName').getText()).toBeUndefined();
    // The filled copy inside the library holds them.
    const copy = await PDFDocument.load(readFileSync(path.join(libraryDir, 'Forms', 'Application (filled).pdf')));
    expect(copy.getForm().getTextField('fullName').getText()).toBe('Ada Lovelace');

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
    try {
      rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Best effort: a leftover temp dir never fails the test.
    }
  }
});

test('rich-text field downloads a filled PDF, filled or left empty', async () => {
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([{ name: 'Forms', files: [{ name: 'RichText.pdf', content: await richTextPdf() }] }]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openFillablePdf(page, 'Forms', 'RichText.pdf');

    await expect(page.getByLabel('GM name')).toBeVisible();
    await expect(page.getByLabel('Your full name (required)')).toBeVisible();

    // Tristen's report: the rich-text field left empty, the plain field
    // filled, and Download filled PDF failed with a rich-text read
    // error. The download must now succeed with the filled value in it.
    await page.getByLabel('Your full name (required)').fill('Ada Lovelace');
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });
    const outPath = path.join(paths.baseDir, 'RichText (filled).pdf');
    await app.evaluate(async ({ dialog }, filePath: string) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, outPath);
    await page.getByRole('button', { name: 'Download filled PDF' }).click();
    await expect(formSection(page).getByRole('status')).toContainText('Downloaded filled PDF', { timeout: 10000 });
    const downloaded = await PDFDocument.load(readFileSync(outPath));
    expect(downloaded.getForm().getTextField('plainName').getText()).toBe('Ada Lovelace');
    expect(downloaded.getForm().getTextField('GM_Name').getText()).toBeUndefined();

    // Fill the rich-text field too: its value must land in the file.
    await page.getByLabel('GM name').fill('Grace Hopper');
    await expect(formSection(page).getByRole('status')).toContainText('Filled values saved.', { timeout: 10000 });
    const outPathFilled = path.join(paths.baseDir, 'RichText (filled again).pdf');
    await app.evaluate(async ({ dialog }, filePath: string) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, outPathFilled);
    await page.getByRole('button', { name: 'Download filled PDF' }).click();
    await expect(formSection(page).getByRole('status')).toContainText('Downloaded filled PDF', { timeout: 10000 });
    const downloadedAgain = await PDFDocument.load(readFileSync(outPathFilled));
    expect(downloadedAgain.getForm().getTextField('GM_Name').getText()).toBe('Grace Hopper');
    expect(downloadedAgain.getForm().getTextField('plainName').getText()).toBe('Ada Lovelace');

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
