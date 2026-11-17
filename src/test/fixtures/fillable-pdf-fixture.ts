/**
 * A deterministic fillable PDF fixture, generated with pdf-lib: one page
 * holding a text field (tooltip + required), a checkbox, a dropdown, a
 * radio group, a multi-select list box, and a push button, each beside
 * a short text label drawn on the page.
 */
import { PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';

export async function fillablePdfFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Full name:', { x: 50, y: 705, size: 12, font });
  page.drawText('I agree to the terms', { x: 70, y: 655, size: 12, font });
  page.drawText('Favorite color:', { x: 50, y: 605, size: 12, font });
  page.drawText('Size:', { x: 50, y: 555, size: 12, font });
  page.drawText('Pick several:', { x: 50, y: 505, size: 12, font });
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
  const list = form.createOptionList('choices');
  list.addOptions(['One', 'Two', 'Three']);
  list.enableMultiselect();
  list.addToPage(page, { x: 150, y: 490, width: 150, height: 40 });
  const button = form.createButton('submitBtn');
  button.addToPage('Submit', page, { x: 50, y: 450, width: 100, height: 20 });
  return doc.save();
}

/** A one-page PDF with no form fields, for the no-fields path. */
export async function plainPdfFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('A plain document with no form.', { x: 50, y: 700, size: 12, font });
  return doc.save();
}

/**
 * A PDF with a rich-text text field left unfilled, as XFA-era producers
 * ship them: the RichText flag is set, the field holds no value, and its
 * widget has no appearance stream, so pdf-lib's appearance builder must
 * read it before the export can save.
 */
export async function richTextPdfFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const rich = form.createTextField('GM_Name');
  rich.addToPage(page, { x: 150, y: 700, width: 200, height: 20 });
  // Enable rich formatting only after the widget exists: pdf-lib builds
  // the appearance on addToPage, and reading an empty rich-text field
  // throws. Real producers ship the flag already set, value or not.
  rich.enableRichFormatting();
  const plain = form.createTextField('plainName');
  plain.addToPage(page, { x: 150, y: 650, width: 200, height: 20 });
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const widget = reloaded.getForm().getTextField('GM_Name').acroField.getWidgets()[0];
  widget.dict.delete(PDFName.of('AP'));
  return reloaded.save({ updateFieldAppearances: false });
}

/**
 * The rich-text fixture with a plain-text value already in the field:
 * the value lives in /V while the RichText flag stays set, as a form
 * pre-filled by another producer would ship.
 */
export async function richTextWithValuePdfFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const rich = form.createTextField('GM_Name');
  rich.addToPage(page, { x: 150, y: 700, width: 200, height: 20 });
  rich.setText('Grace Hopper');
  rich.enableRichFormatting();
  return doc.save({ updateFieldAppearances: false });
}
