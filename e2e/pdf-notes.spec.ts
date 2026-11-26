import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  closeApp,
  dismissTutorial,
  launchApp,
  openGridEntry,
  openNotebook,
  seedLibrary,
  switchView,
  waitForApp,
} from './helpers';

/**
 * PDF notes end-to-end pass: a note created on a quotation shows the
 * notes list under a real "Annotations" heading, an in-text
 * "Note1"/"Note2" button appears at each annotation in the accessible
 * page text, activating one moves focus to that note in the list, and
 * notes from one PDF never appear in another PDF.
 *
 * The fixtures are generated with pdf-lib, so no third-party file is
 * involved. Notes are created through "Annotate a quote", the
 * keyboard/click path, rather than a pointer text selection.
 */
async function textPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 720;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 20;
  }
  return doc.save();
}

async function openPdf(page: Page, fileName: string): Promise<void> {
  await waitForApp(page);
  await expect(page.getByRole('gridcell', { name: 'Notes' })).toBeVisible({ timeout: 30000 });
  await dismissTutorial(page);
  await openNotebook(page, 'Notes');
  await openGridEntry(page, fileName);
  await expect(page.getByRole('heading', { name: 'Page text' })).toBeVisible({ timeout: 30000 });
}

async function annotateQuote(page: Page, quote: string, label: string): Promise<void> {
  const annotate = page.getByRole('button', { name: 'Annotate a quote' });
  // The action stays disabled until the PDF text is extracted and the
  // notes are loaded; on a slow runner that takes a while after the
  // reader heading appears.
  await expect(annotate).toBeEnabled({ timeout: 120000 });
  await annotate.click();
  const quoteDialog = page.getByRole('dialog', { name: 'Choose PDF quotation' });
  await expect(quoteDialog).toBeVisible();
  await quoteDialog.getByRole('textbox', { name: 'Quotation text' }).fill(quote);
  await expect(quoteDialog.getByRole('radio').first()).toBeVisible({ timeout: 10000 });
  await quoteDialog.getByRole('radio').first().click();
  await quoteDialog.getByRole('button', { name: 'Use selected quotation' }).click();
  const noteDialog = page.getByRole('dialog', { name: 'Create PDF note' });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByRole('textbox', { name: 'Label (optional)' }).fill(label);
  await noteDialog.getByRole('button', { name: 'Save' }).click();
  await expect(noteDialog).toHaveCount(0);
}

test('PDF notes have a heading and in-text Note buttons that jump to the note', async () => {
  // Two note creations plus a reopen: on a slow runner the app launch
  // and PDF text extraction alone can eat most of the default budget.
  test.setTimeout(180000);
  let app: ElectronApplication | null = null;
  const paths = seedLibrary([
    {
      name: 'Notes',
      files: [
        {
          name: 'Fox.pdf',
          content: await textPdf([
            'The quick brown fox jumps over the lazy dog.',
            'Pack my box with five dozen liquor jugs.',
          ]),
        },
        {
          name: 'Other.pdf',
          content: await textPdf(['A completely different document with no shared sentences.']),
        },
      ],
    },
  ]);
  try {
    const launched = await launchApp(paths.userDataDir);
    app = launched.app;
    const page = launched.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await openPdf(page, 'Fox.pdf');

    await annotateQuote(page, 'quick brown fox', 'Fox note');
    await annotateQuote(page, 'liquor jugs', 'Jugs note');

    // The notes list sits under a real heading, not styled text.
    await expect(page.getByRole('heading', { name: 'Annotations' })).toBeVisible();

    // One in-text button per annotation, in the accessible page text.
    const pageText = page.getByRole('region', { name: 'Accessible text for PDF page 1' });
    await expect(pageText.getByRole('button', { name: 'Note1' })).toBeVisible();
    await expect(pageText.getByRole('button', { name: 'Note2' })).toBeVisible();

    // Activating a button moves focus to that note in the list.
    await pageText.getByRole('button', { name: 'Note1' }).click();
    await expect(page.getByRole('button', { name: 'Fox note — yellow, page 1' })).toBeFocused();
    await pageText.getByRole('button', { name: 'Note2' }).click();
    await expect(page.getByRole('button', { name: 'Jugs note — yellow, page 1' })).toBeFocused();

    // The other PDF shows none of this PDF's notes.
    await switchView(page, 'Control+2', async () => page.getByRole('gridcell', { name: 'Notes' }).count());
    await openNotebook(page, 'Notes');
    await openGridEntry(page, 'Other.pdf');
    await expect(page.getByRole('heading', { name: 'Page text' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Annotations' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Note1' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Fox note —/ })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, paths);
  }
});
