import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseXlsxWorkbook } from '../electron/vault/xlsx-parser';
import { zip } from '../src/test/test-zip';
import { untaggedReport } from '../src/test/fixtures/pdf-fixtures';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  runPaletteCommand,
  seedLibrary,
  statusLine,
  switchView,
  waitForApp,
  type SeedPaths,
} from './helpers';

/**
 * Verification scenarios for the repeat items from Tristen's manual
 * retests: spreadsheet/csv opening, spreadsheet save-back, import errors,
 * notebook silo, task auto-links, edit-mode focus, bookmark jumps, and
 * ePub/PDF opening. Each test launches the real app against a seeded
 * library, drives the real UI (grids, palette, dialogs), and asserts on
 * the DOM. Screen-reader announcements and virtual-cursor position
 * cannot be checked here; Tristen's manual retest remains the only check
 * for those.
 *
 * Seeded library layout:
 * - Archive/Guide.md — the parent notebook for the silo scenario.
 * - Data/Budget.csv, Budget.xlsx, Report.pdf, Guide.epub — the
 *   documents the open/import scenarios exercise.
 * - Seeded/Seeded note.md — the note for focus/bookmark scenarios.
 * - Tasks/Task note.md — the note the tasks scenario fills in.
 */

const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Minimal two-sheet workbook, mirroring src/test/xlsx-parser.test.ts. */
function validXlsxEntries(): Record<string, string> {
  return {
    'xl/workbook.xml': `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relsNs}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<sst xmlns="${mainNs}" count="2" uniqueCount="2"><si><t>Rent</t></si><si><t>Groceries</t></si></sst>`,
    'xl/styles.xml': `<styleSheet xmlns="${mainNs}"><numFmts><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${mainNs}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200</v></c><c r="C1" t="b"><v>1</v></c><c r="D1"><f>B1*2</f><v>2400</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Note</t></is></c></row><row r="4"><c r="A4"><v>7</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${mainNs}"><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>`,
  };
}

/**
 * A genuine duplicate: two sheets share one worksheet part. The app must
 * reject this with "The XLSX workbook lists the same worksheet twice."
 * (The 1.9.14 fix only removed the false positive for chart sheets; a
 * real duplicate still fails by design.)
 */
function duplicateSheetEntries(): Record<string, string> {
  const entries = validXlsxEntries();
  entries['xl/workbook.xml'] =
    `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Copy" sheetId="2" r:id="rId1"/></sheets></workbook>`;
  return entries;
}

/** A chart sheet between worksheets: the 1.9.14 false positive, now imports. */
function chartSheetEntries(): Record<string, string> {
  const entries = validXlsxEntries();
  entries['xl/workbook.xml'] =
    `<workbook xmlns="${mainNs}" xmlns:r="${relsNs}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Chart1" sheetId="2" r:id="rId3"/><sheet name="Notes" sheetId="3" r:id="rId2"/></sheets></workbook>`;
  entries['xl/_rels/workbook.xml.rels'] =
    `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relsNs}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${relsNs}/chartsheet" Target="charts/chart1.xml"/></Relationships>`;
  return entries;
}

/** Minimal EPUB 2: one chapter plus the table of contents. */
function epubEntries(): Record<string, string> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="verification-book" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>Verification Guide</dc:title><dc:language>en</dc:language><dc:identifier id="verification-book">urn:uuid:verification-guide</dc:identifier></metadata><manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter1"/></spine></package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:verification-guide"/></head><docTitle><text>Verification Guide</text></docTitle><navMap><navPoint id="chapter1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="chapter1.xhtml"/></navPoint></navMap></ncx>`,
    'OEBPS/chapter1.xhtml': `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>This is the first chapter of the verification book.</p></body></html>`,
  };
}

function seedVerificationLibrary(): SeedPaths {
  return seedLibrary([
    {
      name: 'Archive',
      files: [{ name: 'Guide.md', content: '# Archive guide\n\nArchived guidance.\n' }],
    },
    {
      name: 'Data',
      files: [
        { name: 'Budget.csv', content: 'Item,Amount\nRent,1200\nGroceries,350\n' },
        { name: 'Budget.xlsx', content: zip(validXlsxEntries()) },
        { name: 'Report.pdf', content: Buffer.from(untaggedReport(1)) },
        { name: 'Guide.epub', content: zip(epubEntries()) },
      ],
    },
    {
      name: 'Seeded',
      files: [{ name: 'Seeded note.md', content: '# Seeded note\n\nA seeded note for end-to-end tests.\n' }],
    },
    {
      name: 'Tasks',
      files: [{ name: 'Task note.md', content: '# Task note\n\nTasks for the week.\n' }],
    },
  ]);
}

interface LaunchedApp {
  app: ElectronApplication;
  page: import('@playwright/test').Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchVerificationApp(): Promise<LaunchedApp> {
  const paths = seedVerificationLibrary();
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await dismissTutorial(page);
  return { app, page, paths, pageErrors };
}

/**
 * Stub Electron's native open-file dialog in the main process so the
 * Import flow can be driven end to end: the stub returns the fixture
 * path instead of showing an OS dialog. Everything downstream of the
 * pick (validation, copy, tree refresh) is the real code path. The stub
 * must be installed before the Import command runs.
 */
async function stubImportDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: paths,
    });
  }, filePaths);
}

function writeFixture(paths: SeedPaths, name: string, content: Buffer): string {
  const fixtureDir = path.join(paths.baseDir, 'fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, name);
  writeFileSync(fixturePath, content);
  return fixturePath;
}

/** Create a note in the selected notebook, save it, and leave reading mode. */
async function createNote(page: import('@playwright/test').Page, name: string, content: string): Promise<void> {
  await runPaletteCommand(page, 'New note');
  const noteDialog = page.getByRole('dialog', { name: 'New note' });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel('New Note Name').fill(name);
  await noteDialog.getByRole('button', { name: 'New note', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown source' });
  // A newly created note opens in edit mode, but the editor renders
  // asynchronously; wait for it before asserting focus.
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toBeFocused();
  await editor.fill(content);
  await page.keyboard.press('Control+S');
  await expect(statusLine(page)).toContainText(`Saved ${name}.`, { timeout: 30000 });
  // View shortcuts do not fire while the editor has focus in edit mode.
  await page.keyboard.press('Control+E');
  await expect(statusLine(page)).toContainText('Mode switched to read-only.', {
    timeout: 30000,
  });
}

/** Switch to the Notebooks grid (Ctrl+2), the list of notebooks. */
async function showNotebooks(page: import('@playwright/test').Page): Promise<void> {
  await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Archive' }).count());
}

/**
 * Wait until an opened note's reading view has rendered. Ctrl+E is refused
 * while the note is still loading (the command guard needs currentNote),
 * so the heading must be visible before toggling to edit mode — on a slow
 * runner the keypress otherwise lands before the note is current and is
 * dropped with "This view has no note editor."
 */
async function waitForNoteOpen(page: import('@playwright/test').Page, title: string): Promise<void> {
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 30000 });
}

test('csv opens as an editable spreadsheet, not Cognitive Tools', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Data');
    await openGridEntry(page, 'Budget.csv');
    // The spreadsheet grid renders the CSV: header row plus data rows.
    await expect(page.locator('table caption')).toContainText('Budget — ', { timeout: 30000 });
    await expect(page.getByRole('textbox', { name: 'Row 2, column A, Rent' })).toBeVisible();
    // The old bug opened the Assets tab (Cognitive Tools) instead.
    await expect(page.getByRole('heading', { name: 'Cognitive Tools' })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('xlsx opens as an editable spreadsheet and saves back', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Data');
    await openGridEntry(page, 'Budget.xlsx');
    await expect(page.locator('table caption')).toContainText('Budget — 4 rows', { timeout: 30000 });
    const cellB1 = page.getByRole('textbox', { name: 'Row 1, column B, 1200' });
    await expect(cellB1).toBeVisible();
    await cellB1.fill('1300');
    await page.getByRole('button', { name: 'Save spreadsheet (Ctrl+S)' }).click();
    await expect(statusLine(page)).toContainText('Saved Budget.xlsx.', { timeout: 30000 });
    // Prove the edit reached disk: re-read the saved file with the app's
    // own parser and check the edited value.
    const saved = parseXlsxWorkbook(readFileSync(path.join(paths.libraryDir, 'Data', 'Budget.xlsx')));
    expect(saved.sheets[0].rows[0][1].text).toBe('1300');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('importing a workbook that lists the same worksheet twice shows the real error', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Data');
    const fixturePath = writeFixture(paths, 'Duplicate.xlsx', zip(duplicateSheetEntries()));
    await stubImportDialog(app, [fixturePath]);
    await runPaletteCommand(page, 'Import file');
    // The import validation rejects a genuine duplicate; the status bar
    // carries the real reason, and nothing is copied into the library.
    await expect(statusLine(page)).toContainText(
      'Could not import the selected file. The XLSX workbook lists the same worksheet twice.',
      { timeout: 30000 },
    );
    await expect(page.getByRole('gridcell', { name: 'Duplicate.xlsx' })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('importing a workbook with a chart sheet imports successfully', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Data');
    const fixturePath = writeFixture(paths, 'Chart workbook.xlsx', zip(chartSheetEntries()));
    await stubImportDialog(app, [fixturePath]);
    await runPaletteCommand(page, 'Import file');
    // The 1.9.14 false positive: a chart sheet used to collide with a real
    // sheet and report a duplicate. The import must succeed now.
    await expect(page.getByRole('gridcell', { name: 'Chart workbook.xlsx' })).toBeVisible({
      timeout: 30000,
    });
    await expect(statusLine(page)).not.toContainText('Could not import the selected file.');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('notebook silo: a note created in a new notebook appears only there', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    // Tristen's report: a note created in a new "Interview Instructions"
    // notebook also showed in Archive. Reproduce her exact flow, starting
    // with Archive selected.
    await openNotebook(page, 'Archive');

    // --- Library root (the new default) ---
    await runPaletteCommand(page, 'New notebook');
    const dialog = page.getByRole('dialog', { name: 'New notebook' });
    await expect(dialog).toBeVisible();
    // The Location picker is part of the fix: Library root by default,
    // with the selected notebook offered as a parent.
    const location = dialog.getByLabel('Location');
    await expect(location).toHaveValue('');
    await expect(location.locator('option', { hasText: 'Library root' })).toHaveCount(1);
    await expect(location.locator('option', { hasText: 'Inside Archive' })).toHaveCount(1);
    await dialog.getByLabel('New Notebook Name').fill('Interview Instructions');
    await dialog.getByRole('button', { name: 'New notebook', exact: true }).click();
    await expect(statusLine(page)).toContainText('Notebook created in the Library root.', {
      timeout: 30000,
    });

    // Create a note in the new notebook (it is now the selected one).
    await createNote(page, 'Interview note', '# Interview note\n\nPrepare for the second round.\n');

    // Back in Archive: its own note is there; the root notebook and its
    // note are not.
    await showNotebooks(page);
    await openNotebook(page, 'Archive');
    await expect(page.getByRole('gridcell', { name: 'Guide.md' })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'Interview Instructions' })).toHaveCount(0);
    await expect(page.getByRole('gridcell', { name: 'Interview note.md' })).toHaveCount(0);

    // Opening the root notebook reveals its note.
    await showNotebooks(page);
    await openNotebook(page, 'Interview Instructions');
    await expect(page.getByRole('gridcell', { name: 'Interview note.md' })).toBeVisible();

    // --- Inside Archive (nested) ---
    await showNotebooks(page);
    await openNotebook(page, 'Archive');
    await runPaletteCommand(page, 'New notebook');
    const nestedDialog = page.getByRole('dialog', { name: 'New notebook' });
    await expect(nestedDialog).toBeVisible();
    await nestedDialog.getByLabel('Location').selectOption('Archive');
    await nestedDialog.getByLabel('New Notebook Name').fill('Nested Notes');
    await nestedDialog.getByRole('button', { name: 'New notebook', exact: true }).click();
    await expect(statusLine(page)).toContainText('Notebook created inside Archive.', {
      timeout: 30000,
    });
    await createNote(page, 'Nested note', '# Nested note\n\nA note inside a nested notebook.\n');

    // Back in Archive: its own note is there and the sub-notebook is
    // listed, but the sub-notebook's note is not.
    await showNotebooks(page);
    await openNotebook(page, 'Archive');
    await expect(page.getByRole('gridcell', { name: 'Guide.md' })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'Nested Notes' })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'Nested note.md' })).toHaveCount(0);

    // Opening the sub-notebook reveals its note.
    await openNotebook(page, 'Nested Notes', 'Archive/Nested Notes');
    await expect(page.getByRole('gridcell', { name: 'Nested note.md' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('tasks created in a note show the note in the Links column', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Tasks');
    await openGridEntry(page, 'Task note.md');
    await waitForNoteOpen(page, 'Task note');
    // Edit mode, then write two checkbox tasks and save. Tasks are parsed
    // from the saved file, so the save must land before checking Tasks.
    await page.keyboard.press('Control+E');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toBeFocused();
    await editor.fill('# Task note\n\nTasks for the week.\n\n- [ ] Call the dentist\n- [ ] Water the plants\n');
    await page.keyboard.press('Control+S');
    await expect(statusLine(page)).toContainText('Saved Task note.', { timeout: 30000 });

    // View-switch shortcuts do not fire while the Markdown editor has focus
    // in edit mode, so toggle back to reading mode first.
    await page.keyboard.press('Control+E');
    await expect(statusLine(page)).toContainText('Mode switched to read-only.', {
      timeout: 30000,
    });
    const taskRow = (text: string) => page.locator('tr[data-context="task-row"]', { hasText: text });
    await switchView(page, 'Control+4', async () => taskRow('Call the dentist').count());
    // Auto-link reconciliation is async (save, watcher, re-parse), so the
    // Links column assertion polls with the full timeout.
    await expect(
      taskRow('Call the dentist').getByRole('button', { name: 'Open note: Tasks/Task note.md' }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      taskRow('Water the plants').getByRole('button', { name: 'Open note: Tasks/Task note.md' }),
    ).toBeVisible({ timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Ctrl+E moves focus into the editor textbox', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Seeded note.md');
    await waitForNoteOpen(page, 'Seeded note');
    // A freshly opened note is in reading mode; Ctrl+E switches to edit.
    await page.keyboard.press('Control+E');
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeFocused();
    await expect(statusLine(page)).toContainText('Mode switched to edit.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('bookmark jump moves focus to the bookmarked heading', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Seeded');
    await openGridEntry(page, 'Seeded note.md');
    await waitForNoteOpen(page, 'Seeded note');
    await page.keyboard.press('Control+E');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toBeFocused();
    // Caret to the start of the note, inside the "# Seeded note" heading.
    await page.keyboard.press('Control+Home');
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLTextAreaElement).selectionStart))
      .toBe(0);
    await page.keyboard.press('Control+Alt+H');
    const nameDialog = page.getByRole('dialog', { name: 'Name bookmark' });
    await expect(nameDialog).toBeVisible();
    await expect(nameDialog.getByLabel('Bookmark name')).toHaveValue('Seeded note');
    await nameDialog.getByRole('button', { name: 'Save bookmark' }).click();
    // Wait for the dialog to close before toggling mode: a Ctrl+E sent
    // while the dialog is still closing is swallowed, leaving the app in
    // edit mode (where the jump focuses the textarea instead of the heading).
    await expect(nameDialog).toBeHidden({ timeout: 30000 });
    await page.keyboard.press('Control+E');
    await expect(statusLine(page)).toContainText('Mode switched to read-only.', {
      timeout: 30000,
    });
    // Jump from the Bookmarks list in the right pane. DOM-level only:
    // focus lands on the heading and its text is selected. (Whether a
    // screen reader's virtual cursor follows cannot be automated.)
    const bookmarkButton = page.getByRole('button', { name: 'Seeded note — Seeded note.md' });
    await expect(bookmarkButton).toBeVisible({ timeout: 30000 });
    await bookmarkButton.click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            return {
              tag: active?.tagName ?? '',
              text: active?.textContent ?? '',
              selection: window.getSelection()?.toString() ?? '',
            };
          }),
        { timeout: 10000 },
      )
      .toEqual({ tag: 'H1', text: 'Seeded note', selection: 'Seeded note' });
    await expect(statusLine(page)).toContainText('Jumped to Seeded note.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('epub opens as readable content', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Data');
    await openGridEntry(page, 'Guide.epub');
    // The reader renders the chapter and its table of contents. This also
    // proves the real fetch() to vault-file:// that the 1.9.14 CORS fix
    // enabled; the jsdom tests mock fetch, so they cannot prove it.
    // KNOWN APP BUG on unfixed main (caught by this scenario, Nov 9 2026):
    // DocumentReader.tsx:778 reads book?.navigation.toc, but epubjs assigns
    // navigation only after its async open() completes, so the first render
    // after setBook throws and the reader unmounts. Confirmed with a real
    // Project Gutenberg ePub, not just this hand-built fixture. The scenario
    // asserts the fixed behavior and must NOT be weakened to pass on main.
    const reader = page.getByRole('region', { name: 'ePub document reader' });
    await expect(reader).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('navigation', { name: 'ePub table of contents' })).toBeVisible({ timeout: 30000 });
    await expect(
      reader.locator('article', { hasText: 'This is the first chapter of the verification book.' }),
    ).toBeVisible({ timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('pdf opens as readable content', async () => {
  const { app, page, paths, pageErrors } = await launchVerificationApp();
  try {
    await openNotebook(page, 'Data');
    await openGridEntry(page, 'Report.pdf');
    const reader = page.getByRole('region', { name: 'PDF document reader' });
    await expect(reader).toBeVisible({ timeout: 30000 });
    // pdfjs renders the page heading asynchronously; on a slow machine it
    // can take several seconds after the reader section appears.
    await expect(page.getByRole('heading', { name: 'Page 1 of 1' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole('region', { name: 'Accessible text for PDF page 1' })).toContainText(
      'Body text unique to page 1.',
      { timeout: 30000 },
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
