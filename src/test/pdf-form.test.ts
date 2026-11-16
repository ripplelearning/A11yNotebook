// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  derivePdfFormLabel,
  describePdfFormFillState,
  detectPdfAcroForm,
  detectPdfXfa,
  groupPdfFormFields,
  isPdfFormFieldEmpty,
  missingRequiredPdfFormFields,
  normalizePdfWidgetAnnotation,
  validatePdfFormValue,
  type PdfFormField,
} from '../shared/pdf-form';

function textField(overrides: Partial<PdfFormField> = {}): PdfFormField {
  return {
    name: 'fullName',
    type: 'text',
    label: 'Full name',
    labelSource: 'tooltip',
    unlabeled: false,
    page: 1,
    rect: [150, 700, 350, 720],
    required: true,
    readOnly: false,
    maxLength: 0,
    multiline: false,
    password: false,
    ...overrides,
  };
}

describe('fillable PDF form model', () => {
  it('prefers the tooltip, then nearby text, then the field name as the label', () => {
    expect(derivePdfFormLabel({ fieldName: 'fullName', alternativeText: 'Your full name' }, 'Full name:')).toEqual({
      label: 'Your full name',
      labelSource: 'tooltip',
      unlabeled: false,
    });
    expect(derivePdfFormLabel({ fieldName: 'fullName' }, 'Full name:')).toEqual({
      label: 'Full name:',
      labelSource: 'nearby-text',
      unlabeled: false,
    });
    expect(derivePdfFormLabel({ fieldName: 'fullName' }, '')).toEqual({
      label: 'fullName',
      labelSource: 'field-name',
      unlabeled: false,
    });
    expect(derivePdfFormLabel({ fieldName: 'Text1' }, '')).toEqual({
      label: 'Text1',
      labelSource: 'unlabeled',
      unlabeled: true,
    });
  });

  it('normalizes text, checkbox, radio, dropdown, and unsupported widgets', () => {
    const text = normalizePdfWidgetAnnotation(
      { subtype: 'Widget', fieldName: 'fullName', fieldType: 'Tx', fieldValue: '', required: true, maxLen: 40 },
      1,
      'Full name:',
    );
    expect(text).toMatchObject({ type: 'text', required: true, maxLength: 40 });

    const checkbox = normalizePdfWidgetAnnotation(
      { subtype: 'Widget', fieldName: 'agree', fieldType: 'Btn', checkBox: true, exportValue: 'Yes' },
      1,
      '',
    );
    expect(checkbox).toMatchObject({ type: 'checkbox', exportValue: 'Yes' });

    const radio = normalizePdfWidgetAnnotation(
      { subtype: 'Widget', fieldName: 'size', fieldType: 'Btn', radioButton: true, buttonValue: 'Small' },
      1,
      '',
    );
    expect(radio).toMatchObject({ type: 'radio', options: [{ value: 'Small', label: 'Small' }] });

    const dropdown = normalizePdfWidgetAnnotation(
      {
        subtype: 'Widget',
        fieldName: 'color',
        fieldType: 'Ch',
        combo: true,
        options: [{ exportValue: 'Red', displayValue: 'Red' }],
      },
      1,
      '',
    );
    expect(dropdown).toMatchObject({ type: 'dropdown', options: [{ value: 'Red', label: 'Red' }] });

    expect(
      normalizePdfWidgetAnnotation(
        { subtype: 'Widget', fieldName: 'choices', fieldType: 'Ch', multiSelect: true },
        1,
        '',
      ),
    ).toMatchObject({ type: 'unsupported', unsupportedReason: expect.stringContaining('List boxes') });
    expect(
      normalizePdfWidgetAnnotation(
        { subtype: 'Widget', fieldName: 'submitBtn', fieldType: 'Btn', pushButton: true },
        1,
        '',
      ),
    ).toMatchObject({ type: 'unsupported', unsupportedReason: expect.stringContaining('Buttons') });
    expect(
      normalizePdfWidgetAnnotation({ subtype: 'Widget', fieldName: 'sig', fieldType: 'Sig' }, 1, ''),
    ).toMatchObject({ type: 'unsupported', unsupportedReason: expect.stringContaining('Signature') });
    expect(normalizePdfWidgetAnnotation({ subtype: 'Link', fieldName: 'x' }, 1, '')).toBeNull();
    expect(normalizePdfWidgetAnnotation({ subtype: 'Widget', fieldName: '', fieldType: 'Tx' }, 1, '')).toBeNull();
    expect(
      normalizePdfWidgetAnnotation({ subtype: 'Widget', fieldName: 'hidden', fieldType: 'Tx', hidden: true }, 1, ''),
    ).toBeNull();
  });

  it('groups radio widgets sharing a field name into one field', () => {
    const small = normalizePdfWidgetAnnotation(
      { subtype: 'Widget', fieldName: 'size', fieldType: 'Btn', radioButton: true, buttonValue: 'Small' },
      1,
      'Size:',
    )!;
    const large = normalizePdfWidgetAnnotation(
      { subtype: 'Widget', fieldName: 'size', fieldType: 'Btn', radioButton: true, buttonValue: 'Large' },
      1,
      '',
    )!;
    const grouped = groupPdfFormFields([small, large, textField()]);
    expect(grouped).toHaveLength(2);
    expect(grouped.find((field) => field.name === 'size')).toMatchObject({
      type: 'radio',
      options: [
        { value: 'Small', label: 'Small' },
        { value: 'Large', label: 'Large' },
      ],
    });
  });

  it('reports empty, missing-required, and fill state', () => {
    const fields = [
      textField(),
      textField({ name: 'notes', required: false, label: 'Notes', labelSource: 'field-name' }),
      { ...textField({ name: 'agree', type: 'checkbox' as const, required: false, label: 'Agree' }) },
    ];
    const values = { notes: 'hello' };
    expect(isPdfFormFieldEmpty(fields[0], values)).toBe(true);
    expect(isPdfFormFieldEmpty(fields[1], values)).toBe(false);
    expect(isPdfFormFieldEmpty(fields[2], { agree: true })).toBe(false);
    expect(missingRequiredPdfFormFields(fields, values)).toEqual([fields[0]]);
    expect(describePdfFormFillState(fields, values)).toContain('3 fields');
    expect(describePdfFormFillState(fields, values)).toContain('1 filled');
    expect(describePdfFormFillState(fields, values)).toContain('1 required field still empty');
  });

  it('validates dropdown options and text length', () => {
    const dropdown = textField({
      name: 'color',
      type: 'dropdown',
      options: [{ value: 'Red', label: 'Red' }],
    });
    expect(validatePdfFormValue(dropdown, 'Red')).toBeNull();
    expect(validatePdfFormValue(dropdown, 'Purple')).toMatch(/listed options/);
    expect(validatePdfFormValue(textField({ maxLength: 3 }), 'abcd')).toMatch(/at most 3/);
    expect(validatePdfFormValue(textField({ maxLength: 3 }), 'abc')).toBeNull();
  });

  it('detects AcroForm and XFA from raw bytes', () => {
    const plain = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    expect(detectPdfAcroForm(plain)).toBe(false);
    expect(detectPdfXfa(plain)).toBe(false);
    const xfa = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>\nendobj\n' +
        '3 0 obj\n<< /Fields [] /XFA [4 0 R 5 0 R] >>\nendobj\n',
    );
    expect(detectPdfAcroForm(xfa)).toBe(true);
    expect(detectPdfXfa(xfa)).toBe(true);
    const acroOnly = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /AcroForm 3 0 R >>\nendobj\n' + '3 0 obj\n<< /Fields [6 0 R] >>\nendobj\n',
    );
    expect(detectPdfAcroForm(acroOnly)).toBe(true);
    expect(detectPdfXfa(acroOnly)).toBe(false);
  });
});
