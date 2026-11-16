import { PDFDocument, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField, StandardFonts } from 'pdf-lib';
import type { PdfFormValues } from '../../src/shared/pdf-form';

/**
 * Write stored form values into a PDF's AcroForm fields and return the
 * filled file's bytes. The library file is never touched: the caller
 * decides whether the bytes go to a download or a new filled copy.
 *
 * pdf-lib cannot open a password-protected PDF, so a protected source
 * throws here; the caller reports that the filled values stay in the
 * app instead.
 */
export async function applyPdfFormValues(source: Uint8Array, values: PdfFormValues): Promise<Uint8Array> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source, { ignoreEncryption: false });
  } catch (error) {
    if (error instanceof Error && /password|encrypted/i.test(error.message)) {
      throw new Error(
        'This PDF is password-protected, so a filled file cannot be created. The filled values remain saved in the app.',
      );
    }
    throw error;
  }
  const form = document.getForm();
  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      // A field that no longer exists in the file is skipped: the stored
      // values survive a replaced PDF instead of failing the export.
      continue;
    }
    try {
      if (field instanceof PDFTextField) {
        if (typeof value === 'string') field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else if (value === false) field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value !== '' && field.getOptions().includes(value)) field.select(value);
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value !== '' && field.getOptions().includes(value)) field.select(value);
      }
    } catch {
      // One unfillable field (for example a value the file rejects)
      // must not fail the whole export; the other values still land.
      continue;
    }
  }
  try {
    form.updateFieldAppearances(await document.embedFont(StandardFonts.Helvetica));
  } catch {
    // Appearances are a nicety: values are already set, so a field
    // whose appearance cannot be rebuilt must not fail the export.
  }
  return document.save();
}
