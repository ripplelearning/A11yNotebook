import { PDFDocument, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField, StandardFonts } from 'pdf-lib';
import type { PdfFormSkippedField, PdfFormValues } from '../../src/shared/pdf-form';

/** The filled file's bytes, plus any field that could not be written. */
export interface PdfFormExportResult {
  bytes: Uint8Array;
  skippedFields: PdfFormSkippedField[];
}

/** Turn a caught write failure into a reason the user can act on. */
function skipReason(error: unknown): string {
  if (error instanceof Error && /maxLength/i.test(error.message)) {
    return 'The filled value is too long for this field.';
  }
  if (error instanceof Error && /rich text/i.test(error.message)) {
    return 'This rich-text field could not be read.';
  }
  return 'This field could not be written into the filled file.';
}

/**
 * Write stored form values into a PDF's AcroForm fields and return the
 * filled file's bytes. The library file is never touched: the caller
 * decides whether the bytes go to a download or a new filled copy.
 *
 * pdf-lib cannot open a protected PDF, so a protected source throws
 * here; the caller reports that the filled values stay in the app
 * instead.
 *
 * Rich-text text fields need special handling. pdf-lib refuses to read
 * a rich-text field that holds no plain-text value, and its appearance
 * builder reads every field that needs an appearance update — including
 * untouched fields whose widgets have no appearance stream — so one
 * empty rich-text field used to abort the whole export at save time.
 * An empty rich-text field is converted to a plain text field before
 * anything is written; a rich-text field that already holds a
 * plain-text value keeps it, and a filled value converts the field the
 * same way pdf-lib's own setText does. A field that still cannot be
 * written is reported in skippedFields instead of failing the export.
 */
export async function applyPdfFormValues(source: Uint8Array, values: PdfFormValues): Promise<PdfFormExportResult> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source, { ignoreEncryption: false });
  } catch (error) {
    if (error instanceof Error && /password|encrypted/i.test(error.message)) {
      throw new Error(
        'This PDF is protected, so a filled file cannot be created. The filled values remain saved in the app.',
      );
    }
    throw error;
  }
  const form = document.getForm();
  const skippedFields: PdfFormSkippedField[] = [];
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField) || !field.isRichFormatted()) continue;
    try {
      // The plain-text value lives in /V; reading it through the
      // underlying field never throws for rich text the way getText
      // does. A field with no plain-text value is empty, so dropping
      // the RichText flag turns it into a plain empty text field the
      // export can read and write.
      if (!field.acroField.getValue()) field.disableRichFormatting();
    } catch {
      // One unreadable field never fails the export: the value loop
      // below still attempts it and records a skip if it cannot be written.
      continue;
    }
  }
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
    } catch (error) {
      // One unfillable field (for example a value the file rejects)
      // must not fail the whole export; the other values still land,
      // and the skip is reported to the caller.
      skippedFields.push({ name, reason: skipReason(error) });
      continue;
    }
  }
  try {
    form.updateFieldAppearances(await document.embedFont(StandardFonts.Helvetica));
  } catch {
    // Appearances are a nicety: values are already set, so a field
    // whose appearance cannot be rebuilt must not fail the export.
  }
  try {
    return { bytes: await document.save(), skippedFields };
  } catch {
    // Save rebuilds appearances a second time, and that pass can still
    // throw for a field whose appearance cannot be built. The values
    // are already written, so save without rebuilding appearances
    // rather than failing the download.
    return { bytes: await document.save({ updateFieldAppearances: false }), skippedFields };
  }
}
