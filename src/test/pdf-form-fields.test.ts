// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfDocument } from '../renderer/pdf-semantic/pdf-document';
import {
  fillablePdfFixture,
  plainPdfFixture,
  richTextPdfFixture,
  richTextWithValuePdfFixture,
} from './fixtures/fillable-pdf-fixture';

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
    expect(filled.skippedFields).toEqual([]);
    const reloaded = await PDFDocument.load(filled.bytes);
    const form = reloaded.getForm();
    expect(form.getTextField('fullName').getText()).toBe('Ada Lovelace');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getDropdown('color').getSelected()).toEqual(['Green']);
    expect(form.getRadioGroup('size').getSelected()).toBe('Large');
    // Unknown fields and wrong-typed values never fail the export.
    const again = await applyPdfFormValues(bytes, { noSuchField: 'x', agree: 'not-a-boolean' });
    const reloadedAgain = await PDFDocument.load(again.bytes);
    expect(reloadedAgain.getForm().getCheckBox('agree').isChecked()).toBe(false);
  });

  it('exports a PDF with an unfilled rich-text field instead of failing the download', async () => {
    const { applyPdfFormValues } = await import('../../electron/vault/pdf-form-export');
    const bytes = await richTextPdfFixture();
    const filled = await applyPdfFormValues(bytes, { plainName: 'Ada Lovelace' });
    expect(filled.skippedFields).toEqual([]);
    const reloaded = await PDFDocument.load(filled.bytes);
    expect(reloaded.getForm().getTextField('plainName').getText()).toBe('Ada Lovelace');
    // The empty rich-text field exports as an empty plain text field.
    expect(reloaded.getForm().getTextField('GM_Name').getText()).toBeUndefined();
  });

  it('writes a filled value into a rich-text field', async () => {
    const { applyPdfFormValues } = await import('../../electron/vault/pdf-form-export');
    const bytes = await richTextPdfFixture();
    const filled = await applyPdfFormValues(bytes, { GM_Name: 'Grace Hopper', plainName: 'Ada' });
    expect(filled.skippedFields).toEqual([]);
    const reloaded = await PDFDocument.load(filled.bytes);
    expect(reloaded.getForm().getTextField('GM_Name').getText()).toBe('Grace Hopper');
    expect(reloaded.getForm().getTextField('plainName').getText()).toBe('Ada');
  });

  it('keeps a rich-text field’s existing plain-text value', async () => {
    const { applyPdfFormValues } = await import('../../electron/vault/pdf-form-export');
    const bytes = await richTextWithValuePdfFixture();
    const filled = await applyPdfFormValues(bytes, {});
    expect(filled.skippedFields).toEqual([]);
    const reloaded = await PDFDocument.load(filled.bytes);
    expect(reloaded.getForm().getTextField('GM_Name').getText()).toBe('Grace Hopper');
  });

  it('still produces the filled file when saving with rebuilt appearances throws', async () => {
    const { applyPdfFormValues } = await import('../../electron/vault/pdf-form-export');
    const bytes = await fillablePdfFixture();
    const save = vi.spyOn(PDFDocument.prototype, 'save');
    save.mockRejectedValueOnce(new Error('Appearance rebuild failed.'));
    try {
      const filled = await applyPdfFormValues(bytes, { fullName: 'Ada Lovelace' });
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenNthCalledWith(2, { updateFieldAppearances: false });
      const reloaded = await PDFDocument.load(filled.bytes);
      expect(reloaded.getForm().getTextField('fullName').getText()).toBe('Ada Lovelace');
    } finally {
      save.mockRestore();
    }
  });

  it('reports a field that cannot be written instead of failing the export', async () => {
    const { applyPdfFormValues } = await import('../../electron/vault/pdf-form-export');
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const short = form.createTextField('short');
    short.addToPage(page, { x: 150, y: 700, width: 200, height: 20 });
    short.setMaxLength(3);
    const plain = form.createTextField('plainName');
    plain.addToPage(page, { x: 150, y: 650, width: 200, height: 20 });
    const bytes = await doc.save();
    const filled = await applyPdfFormValues(bytes, { short: 'too long', plainName: 'Ada' });
    expect(filled.skippedFields).toEqual([{ name: 'short', reason: 'The filled value is too long for this field.' }]);
    const reloaded = await PDFDocument.load(filled.bytes);
    expect(reloaded.getForm().getTextField('plainName').getText()).toBe('Ada');
  });
});
