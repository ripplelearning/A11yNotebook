import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { formatAliusFile } from '../src/shared/alius';
import { zip } from '../src/test/test-zip';
import {
  canonicalTempDir,
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Alius .docx end-to-end pass (Tristen, 1.9.17 retest): importing
 * "Typing Speeds.docx" as an Alius used to fail in the reader with
 * "DOCX annotations require a Word document." because the annotation
 * store checked the `.alius` record path for a `.docx` extension
 * instead of resolving the record to its original. The reader lists
 * annotations on open, so the whole document never opened.
 *
 * The fixture is a synthetic .docx built with the shared test ZIP
 * builder, so no third-party file is involved. The Alius record is
 * seeded on disk the way the fillable-PDF Alius test seeds one.
 */
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const typesNs = 'http://schemas.openxmlformats.org/package/2006/content-types';

function typingSpeedsDocx(): Buffer {
  const document = `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Typing speeds vary widely.</w:t></w:r></w:p><w:p><w:r><w:t>Practice improves accuracy over time.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
  return zip({
    '[Content_Types].xml': `<Types xmlns="${typesNs}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${relNs}"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': document,
    'word/styles.xml': `<w:styles xmlns:w="${wordNs}"/>`,
    'docProps/core.xml': `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Typing Speeds</dc:title></cp:coreProperties>`,
  });
}

function seedAliusDocxLibrary(): { paths: SeedPaths; outsidePath: string; original: Buffer } {
  const baseDir = mkdtempSync(path.join(canonicalTempDir(), 'a11y-e2e-alius-docx-'));
  const libraryDir = path.join(baseDir, 'library');
  const userDataDir = path.join(baseDir, 'user-data');
  const outsideDir = path.join(baseDir, 'outside');
  mkdirSync(path.join(libraryDir, 'Docs'), { recursive: true });
  mkdirSync(path.join(libraryDir, '.a11ynotebook'), { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const original = typingSpeedsDocx();
  const outsidePath = path.join(outsideDir, 'Typing Speeds.docx');
  writeFileSync(outsidePath, original);
  writeFileSync(
    path.join(libraryDir, 'Docs', 'Typing Speeds.docx.alius'),
    formatAliusFile(outsidePath),
    'utf8',
  );
  // A plain copied .docx in the same notebook: the control case.
  writeFileSync(path.join(libraryDir, 'Docs', 'Copied.docx'), original);
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
  return { paths: { libraryDir, userDataDir, baseDir }, outsidePath, original };
}

async function openDocx(page: Page, fileName: string): Promise<void> {
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Docs' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await openNotebook(page, 'Docs');
  await openGridEntry(page, fileName);
  await expect(page.getByText('Typing speeds vary widely.')).toBeVisible({ timeout: 30000 });
}

test('an Alius .docx opens and reads with no annotations error', async () => {
  let app: ElectronApplication | null = null;
  const { paths } = seedAliusDocxLibrary();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openDocx(page, 'Typing Speeds.docx.alius');
    // The second paragraph renders too: the whole document opened.
    await expect(page.getByText('Practice improves accuracy over time.')).toBeVisible();
    // The annotations section rendered, so the list call succeeded:
    // before the fix this open failed with "DOCX annotations require
    // a Word document." and neither paragraph ever appeared.
    await expect(page.getByText('No annotations for this document.')).toBeVisible();
    await expect(page.getByText('DOCX annotations require a Word document.')).toHaveCount(0);
    await expect(page.getByText('The document changed. Reopen it to continue reading.')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('an annotation on an Alius .docx saves, survives reopen, and never touches the original', async () => {
  let app: ElectronApplication | null = null;
  const { paths, outsidePath, original } = seedAliusDocxLibrary();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openDocx(page, 'Typing Speeds.docx.alius');

    // Select "Typing speeds" in the first paragraph, as a reader would.
    await page.evaluate(() => {
      const paragraph = document.querySelector('[data-docx-block="0"] p');
      if (!paragraph || !paragraph.firstChild) throw new Error('First DOCX paragraph not found.');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, 13);
      const selection = window.getSelection();
      if (!selection) throw new Error('No selection available.');
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.getByRole('button', { name: 'Annotate selection' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add DOCX annotation' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Highlight label').fill('Speeds');
    await dialog.getByRole('button', { name: 'Save annotation' }).click();
    const annotations = page.getByRole('region', { name: 'DOCX annotations' });
    await expect(annotations.getByText('Speeds', { exact: true })).toBeVisible({ timeout: 10000 });

    // Edit the annotation and save: the edit writes back to the
    // library metadata keyed by the Alius record path, and the
    // original outside the library is still byte-for-byte unchanged.
    await annotations.getByRole('button', { name: 'Edit annotation: Speeds' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit DOCX annotation' });
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel('Highlight label').fill('Speeds edited');
    await editDialog.getByRole('button', { name: 'Save annotation' }).click();
    await expect(annotations.getByText('Speeds edited')).toBeVisible({ timeout: 10000 });
    expect(readFileSync(outsidePath).equals(original)).toBe(true);

    // Reopen the Alius: the edited annotation is still there.
    await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Docs' }).count());
    await openNotebook(page, 'Docs');
    await openGridEntry(page, 'Typing Speeds.docx.alius');
    await expect(page.getByText('Typing speeds vary widely.')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('region', { name: 'DOCX annotations' }).getByText('Speeds edited')).toBeVisible({
      timeout: 10000,
    });
    expect(readFileSync(outsidePath).equals(original)).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('a plain copied .docx still opens and reads', async () => {
  let app: ElectronApplication | null = null;
  const { paths } = seedAliusDocxLibrary();
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openDocx(page, 'Copied.docx');
    await expect(page.getByText('Practice improves accuracy over time.')).toBeVisible();
    await expect(page.getByText('No annotations for this document.')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
