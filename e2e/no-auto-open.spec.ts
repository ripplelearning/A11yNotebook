import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { zip } from '../src/test/test-zip';
import {
  closeApp,
  copyFileToClipboard,
  dismissTutorial,
  launchApp,
  openGridEntry,
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
 * No-auto-open end-to-end pass (Tristen, 1.9.17 retest): after an import
 * or a paste, the new item must NOT open in a tab — it appears in Notes
 * and Files, and she opens it when ready. This covers both import paths
 * (Make a copy, Create an Alius), text and structured-content paste, and
 * whole-file paste. The .docx cases also cover the spurious "The
 * document changed. Reopen it to continue reading." message: it used to
 * appear when the auto-open raced the watcher right after import, so
 * these tests assert it never appears after an import — and that the
 * imported .docx still opens cleanly when she opens it herself.
 */

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchNoAutoOpenApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([
    {
      name: 'Seeded',
      files: [{ name: 'Seeded note.md', content: '# Seeded note\n' }],
    },
    { name: 'Second', files: [] },
  ]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Seeded' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

/** Click the panel (not a row or an editor) so Ctrl+V reaches the panel paste handler. */
async function focusPanel(page: Page): Promise<void> {
  await page.getByText(/Items in /, { exact: false }).first().click();
}

async function writeTextClipboard(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

async function writeHtmlClipboard(app: ElectronApplication, html: string, plain: string): Promise<void> {
  await app.evaluate(
    ({ clipboard, ClipboardItem }, { htmlValue, plainValue }) =>
      clipboard.write([new ClipboardItem({ 'text/html': htmlValue, 'text/plain': plainValue })]),
    { htmlValue: html, plainValue: plain },
  );
}

/**
 * Stub Electron's native open-file dialog in the main process so the
 * Import flow can be driven end to end (as in verification.spec.ts).
 * The stub must be installed before the Import command runs.
 */
async function stubImportDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: paths,
    });
  }, filePaths);
}

function writeFixture(paths: SeedPaths, name: string, content: string | Buffer): string {
  const fixtureDir = path.join(paths.baseDir, 'fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, name);
  writeFileSync(fixturePath, content);
  return fixturePath;
}

/** No tab for the named item is open. Assert after the grid/status checks, so the flow has settled. */
async function expectNoTab(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('tab', { name })).toHaveCount(0);
}

function expectNoDocumentChangedMessage(page: Page): Promise<void> {
  return expect(page.getByText('The document changed. Reopen it to continue reading.')).toHaveCount(0);
}

const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const typesNs = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Minimal synthetic .docx, mirroring alius-docx.spec.ts. */
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

test('import a file as a copy does not open it', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page, paths } = launched;
    await openNotebook(page, 'Seeded');
    const fixturePath = writeFixture(paths, 'Report.txt', 'Quarterly report contents.\n');
    await stubImportDialog(app, [fixturePath]);
    await runPaletteCommand(page, 'Import file');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Make a copy/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Report.txt' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Imported Report.txt. The original file was kept.', {
      timeout: 30000,
    });
    await expectNoTab(page, 'Report');
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('import a file as an Alius does not open it', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page, paths } = launched;
    await openNotebook(page, 'Seeded');
    const fixturePath = writeFixture(paths, 'Report.txt', 'Quarterly report contents.\n');
    await stubImportDialog(app, [fixturePath]);
    await runPaletteCommand(page, 'Import file');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Create an Alius/).click();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Report.txt.alius' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Imported Report.txt as an Alius. The original file was kept.', {
      timeout: 30000,
    });
    await expectNoTab(page, 'Report');
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('import a .docx as a copy shows no document-changed message, and opens cleanly when opened', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page, paths } = launched;
    await openNotebook(page, 'Seeded');
    const fixturePath = writeFixture(paths, 'Typing Speeds.docx', typingSpeedsDocx());
    await stubImportDialog(app, [fixturePath]);
    await runPaletteCommand(page, 'Import file');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Typing Speeds.docx' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Imported Typing Speeds.docx. The original file was kept.', {
      timeout: 30000,
    });
    await expectNoTab(page, 'Typing Speeds');
    await expectNoDocumentChangedMessage(page);
    // She opens it when ready: the document reads, with no
    // document-changed message from the import race.
    await openGridEntry(page, 'Typing Speeds.docx');
    await expect(page.getByText('Typing speeds vary widely.')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Practice improves accuracy over time.')).toBeVisible();
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('import a .docx as an Alius shows no document-changed message, and opens cleanly when opened', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page, paths } = launched;
    await openNotebook(page, 'Seeded');
    const fixturePath = writeFixture(paths, 'Typing Speeds.docx', typingSpeedsDocx());
    await stubImportDialog(app, [fixturePath]);
    await runPaletteCommand(page, 'Import file');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Create an Alius/).click();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Typing Speeds.docx.alius' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText(
      'Imported Typing Speeds.docx as an Alius. The original file was kept.',
      { timeout: 30000 },
    );
    await expectNoTab(page, 'Typing Speeds');
    await expectNoDocumentChangedMessage(page);
    await openGridEntry(page, 'Typing Speeds.docx.alius');
    await expect(page.getByText('Typing speeds vary widely.')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Practice improves accuracy over time.')).toBeVisible();
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste text does not open the new note', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeTextClipboard(app, 'Shopping list\n- milk\n- bread');
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = page.getByRole('dialog', { name: 'Paste into notebook' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(page.getByRole('gridcell', { name: 'Shopping list.md' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Pasted Shopping list.md into Seeded.', { timeout: 30000 });
    await expectNoTab(page, 'Shopping list');
    // The note's content is not on screen: it never opened.
    await expect(page.getByText('milk', { exact: true })).toHaveCount(0);
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste structured HTML as markdown does not open the new note', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page } = launched;
    await openNotebook(page, 'Seeded');
    await writeHtmlClipboard(
      app,
      '<h1>Guide</h1><ul><li>First step</li><li>Second step</li></ul>' +
        '<table><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>1</td></tr></table>',
      'Guide',
    );
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = page.getByRole('dialog', { name: 'Paste into notebook' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Format').selectOption('markdown');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await expect(page.getByRole('gridcell', { name: 'Guide.md' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Pasted Guide.md into Seeded.', { timeout: 30000 });
    await expectNoTab(page, 'Guide');
    await expect(page.getByText('First step', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Alpha', { exact: true })).toHaveCount(0);
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a folder as a library adds it without switching libraries', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page, paths } = launched;
    // One notebook, no loose files: no orphan-organize dialog.
    const pastedDir = path.join(paths.baseDir, 'fixtures', 'PastedLibrary');
    mkdirSync(path.join(pastedDir, 'Research'), { recursive: true });
    // The Libraries grid is the switch detector: the navigation pane
    // also shows a 'library' heading, so the heading alone cannot tell
    // the views apart.
    await switchView(page, 'Control+1', async () =>
      page.getByRole('grid', { name: 'Libraries' }).count(),
    );
    await copyFileToClipboard(app, pastedDir);
    await page.getByRole('main').getByRole('heading', { name: 'library', exact: true }).click();
    await pressShortcut(page, 'Control+V');
    const dialog = page.getByRole('dialog', { name: 'Paste library' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Use the original folder as the library/).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(statusLine(page)).toContainText(
      'Added library PastedLibrary. Open it from Libraries when ready.',
      { timeout: 30000 },
    );
    // The library is listed, and the current library is unchanged.
    // The path cell also ends in PastedLibrary, so match the name cell exactly.
    await expect(page.getByRole('gridcell', { name: 'PastedLibrary', exact: true })).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'library', exact: true }),
    ).toBeVisible();
    await switchView(page, 'Control+2', async () =>
      page.getByRole('gridcell', { name: 'Seeded' }).count(),
    );
    await expect(page.getByRole('gridcell', { name: 'Seeded' })).toBeVisible();
    // She opens it when ready: the pasted library opens, with its notebook.
    await switchView(page, 'Control+1', async () =>
      page.getByRole('gridcell', { name: 'PastedLibrary' }).count(),
    );
    await openGridEntry(page, 'PastedLibrary');
    await expect(statusLine(page)).toContainText('Opened library PastedLibrary.', { timeout: 30000 });
    await expect(page.getByRole('gridcell', { name: 'Research' })).toBeVisible();
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});

test('paste a whole file does not open it', async () => {
  let launched: LaunchedApp | null = null;
  try {
    launched = await launchNoAutoOpenApp();
    const { app, page, paths } = launched;
    const fixtureDir = path.join(paths.baseDir, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'Report.txt');
    writeFileSync(fixturePath, 'Quarterly report contents.\n', 'utf8');
    await openNotebook(page, 'Seeded');
    await copyFileToClipboard(app, fixturePath);
    await focusPanel(page);
    await pressShortcut(page, 'Control+V');
    const dialog = page.getByRole('dialog', { name: 'Import file' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('gridcell', { name: 'Report.txt' })).toBeVisible({ timeout: 30000 });
    await expect(statusLine(page)).toContainText('Pasted Report.txt into Seeded.', { timeout: 30000 });
    await expectNoTab(page, 'Report');
    await expectNoDocumentChangedMessage(page);
    expect(launched.pageErrors).toEqual([]);
  } finally {
    if (launched) await closeApp(launched.app, launched.paths);
  }
});
