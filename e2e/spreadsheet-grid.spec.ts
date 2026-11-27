import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseXlsxWorkbook } from '../electron/vault/xlsx-parser';
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
 * Spreadsheet grid model, end to end: keyboard navigation, selection,
 * editing, and sheet switching in the real app against a seeded library.
 * Screen-reader announcements and virtual-cursor position cannot be
 * checked here; Tristen's manual retest remains the only check for those.
 *
 * Seeded library layout:
 * - Data/Budget.xlsx — two sheets: Budget (3 rows, one formula cell)
 *   and Notes (one row, A1 merged across two columns).
 */

/** Two-sheet workbook: Budget with a formula cell, Notes with a merge. */
function buildWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const budget = XLSX.utils.aoa_to_sheet([
    ['Rent', 1200],
    ['Food', 300],
    ['Total', { t: 'n', f: 'SUM(B1:B2)', v: 1500 }],
  ]);
  XLSX.utils.book_append_sheet(wb, budget, 'Budget');
  const notes = XLSX.utils.aoa_to_sheet([['Title', '']]);
  notes['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, notes, 'Notes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  paths: SeedPaths;
  pageErrors: string[];
}

async function launchGridApp(): Promise<LaunchedApp> {
  const paths = seedLibrary([{ name: 'Data', files: [{ name: 'Budget.xlsx', content: buildWorkbook() }] }]);
  const { app, page } = await launchApp(paths.userDataDir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await waitForApp(page);
  await dismissTutorial(page);
  await openNotebook(page, 'Data');
  await openGridEntry(page, 'Budget.xlsx');
  await expect(page.locator('table caption')).toContainText('Budget — 3 rows', { timeout: 30000 });
  return { app, page, paths, pageErrors };
}

function cell(page: Page, name: string) {
  return page.getByRole('gridcell', { name, exact: true });
}

/**
 * Ctrl+Home/Ctrl+End are grid-local keys, not registry commands, so they
 * are pressed literally — but on macOS the app reads the Command key
 * where a shortcut says Ctrl, and this grid handler accepts either.
 */
async function pressGridEdge(page: Page, key: 'Home' | 'End') {
  await page.keyboard.press(process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`);
}

test('arrow keys move the active cell and Home, End, and paging jump', async () => {
  const { app, page, paths, pageErrors } = await launchGridApp();
  try {
    const a1 = cell(page, 'Row 1, column A, Rent');
    await a1.click();
    await expect(a1).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cell(page, 'Row 1, column B, 1200')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 'Row 2, column B, 300')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(cell(page, 'Row 2, column A, Food')).toBeFocused();
    await page.keyboard.press('End');
    await expect(cell(page, 'Row 2, column B, 300')).toBeFocused();
    await pressGridEdge(page, 'End');
    await expect(cell(page, 'Row 3, column B, formula, 1500')).toBeFocused();
    await pressGridEdge(page, 'Home');
    await expect(cell(page, 'Row 1, column A, Rent')).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(cell(page, 'Row 3, column A, Total')).toBeFocused();
    await page.keyboard.press('PageUp');
    await expect(cell(page, 'Row 1, column A, Rent')).toBeFocused();
    // Arrow keys stop at the edges instead of leaving the sheet.
    await page.keyboard.press('ArrowUp');
    await expect(cell(page, 'Row 1, column A, Rent')).toBeFocused();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Shift+arrows extend the selection and announce its size', async () => {
  const { app, page, paths, pageErrors } = await launchGridApp();
  try {
    const a1 = cell(page, 'Row 1, column A, Rent');
    await a1.click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(cell(page, 'Row 1, column A, Rent')).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 'Row 1, column B, 1200')).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 'Row 2, column A, Food')).toHaveAttribute('aria-selected', 'false');
    await expect(statusLine(page)).toContainText('A1 to B1, 1 row by 2 columns', { timeout: 30000 });
    await page.keyboard.press('Shift+ArrowDown');
    await expect(statusLine(page)).toContainText('A1 to B2, 2 rows by 2 columns', { timeout: 30000 });
    // A plain arrow collapses the range back to one cell.
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 'Row 3, column B, formula, 1500')).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 'Row 1, column A, Rent')).toHaveAttribute('aria-selected', 'false');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('F2 edits, Enter commits and moves down, Escape cancels, typing starts editing', async () => {
  const { app, page, paths, pageErrors } = await launchGridApp();
  try {
    const b1 = cell(page, 'Row 1, column B, 1200');
    await b1.click();
    await page.keyboard.press('F2');
    const editor = page.getByRole('textbox', { name: 'Row 1, column B, 1200' });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('1200');
    await editor.fill('1300');
    await page.keyboard.press('Enter');
    await expect(cell(page, 'Row 1, column B, 1300')).toBeVisible();
    await expect(cell(page, 'Row 2, column B, 300')).toBeFocused();
    // Escape restores the prior value.
    await page.keyboard.press('F2');
    const second = page.getByRole('textbox', { name: 'Row 2, column B, 300' });
    await second.fill('9999');
    await page.keyboard.press('Escape');
    await expect(cell(page, 'Row 2, column B, 300')).toBeVisible();
    await expect(cell(page, 'Row 2, column B, 9999')).toHaveCount(0);
    await expect(cell(page, 'Row 2, column B, 300')).toBeFocused();
    // Typing a character starts editing with that character.
    await cell(page, 'Row 1, column A, Rent').click();
    await page.keyboard.press('x');
    const typed = page.getByRole('textbox', { name: 'Row 1, column A, Rent' });
    await expect(typed).toHaveValue('x');
    await page.keyboard.press('Escape');
    await expect(cell(page, 'Row 1, column A, Rent')).toBeVisible();
    // The committed edit survives a save back to disk.
    await page.getByRole('button', { name: 'Save spreadsheet (Ctrl+S)' }).click();
    await expect(statusLine(page)).toContainText('Saved Budget.xlsx.', { timeout: 30000 });
    const saved = parseXlsxWorkbook(readFileSync(path.join(paths.libraryDir, 'Data', 'Budget.xlsx')));
    expect(saved.sheets[0].rows[0][1].text).toBe('1300');
    expect(saved.sheets[0].rows[1][1].text).toBe('300');
    expect(saved.sheets[0].rows[0][0].text).toBe('Rent');
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});

test('Ctrl+PageDown and Ctrl+PageUp switch sheets', async () => {
  const { app, page, paths, pageErrors } = await launchGridApp();
  try {
    const a1 = cell(page, 'Row 1, column A, Rent');
    await a1.click();
    await pressShortcut(page, 'Control+PageDown');
    await expect(page.locator('table caption')).toContainText('Notes — 1 row', { timeout: 30000 });
    const title = cell(page, 'Row 1, column A, merged across 2 columns, Title');
    await expect(title).toBeVisible();
    await expect(title).toHaveAttribute('colspan', '2');
    await expect(statusLine(page)).toContainText('Sheet Notes.', { timeout: 30000 });
    await pressShortcut(page, 'Control+PageUp');
    await expect(page.locator('table caption')).toContainText('Budget — 3 rows', { timeout: 30000 });
    await expect(statusLine(page)).toContainText('Sheet Budget.', { timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
