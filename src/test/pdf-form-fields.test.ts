// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfDocument } from '../renderer/pdf-semantic/pdf-document';
import { fillablePdfFixture, plainPdfFixture } from './fixtures/fillable-pdf-fixture';

describe('fillable PDF field extraction', () => {
  it('extracts text, checkbox, radio, and dropdown fields with labels in reading order', async () => {
    const bytes = await fillablePdfFixture();
    const document = new PdfDocument(bytes, 'fillable-hash', 'Forms/fillable.pdf');
    try {
      await document.ready;
      const fields = await document.getFormFields();
      expect(fields.map((field) => field.name)).toEqual(['fullName', 'agree', 'color', 'size', 'choices', 'submitBtn']);
      const [name, agree, color, size, choices, button] = fields;
      expect(name).toMatchObject({
        type: 'text',
        label: 'Your full name',
        labelSource: 'tooltip',
        required: true,
        page: 1,
      });
      expect(agree).toMatchObject({ type: 'checkbox', label: 'I agree to the terms', labelSource: 'nearby-text' });
      expect(color).toMatchObject({
        type: 'dropdown',
        label: 'Favorite color:',
        options: [
          { value: 'Red', label: 'Red' },
          { value: 'Green', label: 'Green' },
          { value: 'Blue', label: 'Blue' },
        ],
      });
      expect(size).toMatchObject({
        type: 'radio',
        label: 'Size:',
        options: [
          { value: 'Small', label: 'Small' },
          { value: 'Large', label: 'Large' },
        ],
      });
      expect(choices).toMatchObject({ type: 'unsupported', unsupportedReason: expect.stringContaining('List boxes') });
      expect(button).toMatchObject({ type: 'unsupported', unsupportedReason: expect.stringContaining('Buttons') });
      // The same page object carries the fields for inline rendering.
      const page = await document.getPage(1);
      expect(page.formFields.map((field) => field.name)).toEqual(fields.map((field) => field.name));
    } finally {
      await document.destroy();
    }
  });

  it('finds no fields in a plain PDF', async () => {
    const bytes = await plainPdfFixture();
    const document = new PdfDocument(bytes, 'plain-hash', 'Forms/plain.pdf');
    try {
      await document.ready;
      expect(await document.getFormFields()).toEqual([]);
    } finally {
      await document.destroy();
    }
  });

  it('round-trips filled values through the export writer', async () => {
    const { applyPdfFormValues } = await import('../../electron/vault/pdf-form-export');
    const bytes = await fillablePdfFixture();
    const filled = await applyPdfFormValues(bytes, {
      fullName: 'Ada Lovelace',
      agree: true,
      color: 'Green',
      size: 'Large',
    });
    const reloaded = await PDFDocument.load(filled);
    const form = reloaded.getForm();
    expect(form.getTextField('fullName').getText()).toBe('Ada Lovelace');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getDropdown('color').getSelected()).toEqual(['Green']);
    expect(form.getRadioGroup('size').getSelected()).toBe('Large');
    // Unknown fields and wrong-typed values never fail the export.
    const again = await applyPdfFormValues(bytes, { noSuchField: 'x', agree: 'not-a-boolean' });
    const reloadedAgain = await PDFDocument.load(again);
    expect(reloadedAgain.getForm().getCheckBox('agree').isChecked()).toBe(false);
  });
});
