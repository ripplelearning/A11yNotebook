/**
 * Fillable PDF form fields: the shared model for fields extracted from a
 * PDF's AcroForm, the values filled in by the user, and the in-app store
 * those values live in.
 *
 * Filled values are stored in the app, keyed by the document's library
 * path (like PDF notes), and never written into the library file itself.
 * A real filled file is produced only by the "Download filled PDF"
 * export, which writes the stored values into a fresh copy with pdf-lib.
 */

export const PDF_FORM_SCHEMA_VERSION = 1 as const;

/** Field types the app can fill: the same set FRAME PDF Studio supports. */
export type PdfFormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'unsupported';

/** Where a field's accessible label came from. */
export type PdfFormLabelSource = 'tooltip' | 'nearby-text' | 'field-name' | 'unlabeled';

/** One option of a radio group or dropdown. */
export interface PdfFormFieldOption {
  /** The value written into the PDF (export value / button value). */
  value: string;
  /** The label shown to the user. */
  label: string;
}

export interface PdfFormField {
  /** Fully qualified field name; the key values are stored under. */
  name: string;
  type: PdfFormFieldType;
  /** Accessible label: tooltip, nearby text, field name, or the field name flagged unlabeled. */
  label: string;
  labelSource: PdfFormLabelSource;
  /** True when no tooltip, nearby text, or usable field name was found. */
  unlabeled: boolean;
  /** 1-based page number. */
  page: number;
  /** PDF user-space rectangle [x1, y1, x2, y2] of the first widget. */
  rect: [number, number, number, number];
  required: boolean;
  readOnly: boolean;
  /** Text fields only: maximum characters, 0 when unlimited. */
  maxLength: number;
  /** Text fields only: a multi-line field renders as a text area. */
  multiline: boolean;
  /** Text fields only: a password field renders masked. */
  password: boolean;
  /** Checkbox only: the export value that means checked (usually "Yes"). */
  exportValue?: string;
  /** Radio and dropdown only. */
  options?: PdfFormFieldOption[];
  /** Why an unsupported field cannot be filled (list box, button, signature). */
  unsupportedReason?: string;
}

/** A filled value: text (or the selected option) or a checkbox state. */
export type PdfFormValue = string | boolean;

/** All filled values for one document, keyed by field name. */
export type PdfFormValues = Record<string, PdfFormValue>;

export interface PdfFormValuesRecord {
  /** Library-relative path of the PDF (the Alius record path for an Alius). */
  path: string;
  documentIdentity: {
    fingerprint: string;
    fileHash: string;
    vaultPath: string;
  };
  values: PdfFormValues;
  updatedAt: string;
  schemaVersion: typeof PDF_FORM_SCHEMA_VERSION;
}

export const PDF_FORM_VALUE_LIMITS = {
  fieldName: 4096,
  textValue: 10_000,
  fields: 1000,
  records: 5000,
} as const;

/** The raw widget annotation shape pdf.js returns from page.getAnnotations(). */
export interface PdfWidgetAnnotation {
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  fieldFlags?: number;
  alternativeText?: string;
  required?: boolean;
  readOnly?: boolean;
  maxLen?: number;
  multiLine?: boolean;
  password?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string;
  exportValue?: string;
  options?: Array<{ exportValue?: string; displayValue?: string }>;
  combo?: boolean;
  multiSelect?: boolean;
  hidden?: boolean;
  rect?: number[];
}

/** Field names pdf.js generates for unnamed fields look like "Text1" or "Check Box2". */
const GENERATED_FIELD_NAME = /^(Text|Check Box|Button|Dropdown|List Box|Signature)\d*$/i;

/**
 * Derive a field's accessible label. The tooltip (/TU) wins; then nearby
 * text from the page; then the field name; a generated-looking name with
 * nothing else counts as unlabeled.
 */
export function derivePdfFormLabel(
  annotation: PdfWidgetAnnotation,
  nearbyText: string,
): { label: string; labelSource: PdfFormLabelSource; unlabeled: boolean } {
  const tooltip = typeof annotation.alternativeText === 'string' ? annotation.alternativeText.trim() : '';
  if (tooltip) return { label: tooltip, labelSource: 'tooltip', unlabeled: false };
  const nearby = nearbyText.trim().replace(/\s+/g, ' ');
  if (nearby) return { label: nearby, labelSource: 'nearby-text', unlabeled: false };
  const name = typeof annotation.fieldName === 'string' ? annotation.fieldName.trim() : '';
  if (name && !GENERATED_FIELD_NAME.test(name)) return { label: name, labelSource: 'field-name', unlabeled: false };
  return {
    label: name || 'Unlabeled field',
    labelSource: 'unlabeled',
    unlabeled: true,
  };
}

/**
 * Normalize one pdf.js widget annotation into a form field. Returns null
 * for annotations that are not fillable widgets (hidden widgets, widgets
 * without a field name, and non-widget annotations). Radio buttons that
 * share a field name are normalized per widget; the caller groups them.
 */
export function normalizePdfWidgetAnnotation(
  annotation: PdfWidgetAnnotation,
  page: number,
  nearbyText: string,
): PdfFormField | null {
  if (annotation.subtype !== 'Widget' || annotation.hidden) return null;
  const name = typeof annotation.fieldName === 'string' ? annotation.fieldName.trim() : '';
  if (!name) return null;
  const rect =
    Array.isArray(annotation.rect) && annotation.rect.length === 4 && annotation.rect.every(Number.isFinite)
      ? (annotation.rect as [number, number, number, number])
      : ([0, 0, 0, 0] as [number, number, number, number]);
  const { label, labelSource, unlabeled } = derivePdfFormLabel(annotation, nearbyText);
  const base = {
    name,
    label,
    labelSource,
    unlabeled,
    page,
    rect,
    required: annotation.required === true,
    readOnly: annotation.readOnly === true,
  };
  if (annotation.fieldType === 'Tx') {
    return {
      ...base,
      type: 'text',
      maxLength: typeof annotation.maxLen === 'number' && annotation.maxLen > 0 ? annotation.maxLen : 0,
      multiline: annotation.multiLine === true,
      password: annotation.password === true,
    };
  }
  if (annotation.fieldType === 'Btn') {
    if (annotation.pushButton === true) {
      return {
        ...base,
        type: 'unsupported',
        maxLength: 0,
        multiline: false,
        password: false,
        unsupportedReason: 'Buttons cannot be filled in the app.',
      };
    }
    if (annotation.radioButton === true) {
      return {
        ...base,
        type: 'radio',
        maxLength: 0,
        multiline: false,
        password: false,
        options: [
          {
            value: typeof annotation.buttonValue === 'string' ? annotation.buttonValue : '',
            label: typeof annotation.buttonValue === 'string' ? annotation.buttonValue : '',
          },
        ],
      };
    }
    return {
      ...base,
      type: 'checkbox',
      maxLength: 0,
      multiline: false,
      password: false,
      exportValue: typeof annotation.exportValue === 'string' ? annotation.exportValue : 'Yes',
    };
  }
  if (annotation.fieldType === 'Ch') {
    if (annotation.multiSelect === true) {
      return {
        ...base,
        type: 'unsupported',
        maxLength: 0,
        multiline: false,
        password: false,
        unsupportedReason: 'List boxes cannot be filled in the app.',
      };
    }
    const options = (annotation.options ?? []).map((option) => ({
      value: typeof option.exportValue === 'string' ? option.exportValue : '',
      label: typeof option.displayValue === 'string' ? option.displayValue : (option.exportValue ?? ''),
    }));
    return {
      ...base,
      type: 'dropdown',
      maxLength: 0,
      multiline: false,
      password: false,
      options,
    };
  }
  if (annotation.fieldType === 'Sig') {
    return {
      ...base,
      type: 'unsupported',
      maxLength: 0,
      multiline: false,
      password: false,
      unsupportedReason: 'Signature fields cannot be filled in the app.',
    };
  }
  return {
    ...base,
    type: 'unsupported',
    maxLength: 0,
    multiline: false,
    password: false,
    unsupportedReason: 'This field type cannot be filled in the app.',
  };
}

/**
 * Merge per-widget radio buttons that share a field name into one radio
 * group field with one option per widget. Other fields pass through.
 * The group keeps the first widget's rectangle for inline placement.
 */
export function groupPdfFormFields(fields: PdfFormField[]): PdfFormField[] {
  const grouped: PdfFormField[] = [];
  const radios = new Map<string, PdfFormField>();
  for (const field of fields) {
    if (field.type !== 'radio') {
      grouped.push(field);
      continue;
    }
    const existing = radios.get(field.name);
    if (!existing) {
      radios.set(field.name, { ...field, options: [...(field.options ?? [])] });
      grouped.push(radios.get(field.name)!);
      continue;
    }
    for (const option of field.options ?? []) {
      if (!existing.options!.some((candidate) => candidate.value === option.value)) {
        existing.options!.push(option);
      }
    }
  }
  return grouped;
}

/** The stored value for a field, or its empty state. */
export function pdfFormFieldValue(field: PdfFormField, values: PdfFormValues): PdfFormValue {
  const value = values[field.name];
  if (field.type === 'checkbox') return value === true;
  if (typeof value === 'string') return value;
  return '';
}

/** True when a field holds no filled value. */
export function isPdfFormFieldEmpty(field: PdfFormField, values: PdfFormValues): boolean {
  const value = pdfFormFieldValue(field, values);
  return field.type === 'checkbox' ? value !== true : value === '';
}

/** Required fields that are still empty, in reading order. */
export function missingRequiredPdfFormFields(fields: PdfFormField[], values: PdfFormValues): PdfFormField[] {
  return fields.filter((field) => field.required && !field.readOnly && isPdfFormFieldEmpty(field, values));
}

/**
 * Validate one filled value: a dropdown value must be one of its options,
 * and a text value must fit its maximum length. Returns the reason when
 * invalid, or null when the value is fine. Required-emptiness is checked
 * separately by missingRequiredPdfFormFields.
 */
export function validatePdfFormValue(field: PdfFormField, value: PdfFormValue): string | null {
  if (field.type === 'dropdown' && typeof value === 'string' && value !== '') {
    if (!(field.options ?? []).some((option) => option.value === value)) {
      return 'Choose one of the listed options.';
    }
  }
  if (field.type === 'text' && typeof value === 'string') {
    if (field.maxLength > 0 && value.length > field.maxLength) {
      return `Enter at most ${field.maxLength} characters.`;
    }
  }
  if (field.type === 'checkbox' && typeof value !== 'boolean') return 'Choose checked or unchecked.';
  if (field.type === 'radio' && typeof value === 'string' && value !== '') {
    if (!(field.options ?? []).some((option) => option.value === value)) {
      return 'Choose one of the listed options.';
    }
  }
  return null;
}

/** A short human-readable summary of a form's fill state for announcements. */
export function describePdfFormFillState(fields: PdfFormField[], values: PdfFormValues): string {
  const fillable = fields.filter((field) => field.type !== 'unsupported' && !field.readOnly);
  const required = fillable.filter((field) => field.required);
  const missing = missingRequiredPdfFormFields(fields, values);
  const filled = fillable.filter((field) => !isPdfFormFieldEmpty(field, values)).length;
  const unsupported = fields.filter((field) => field.type === 'unsupported').length;
  const parts = [
    `${fields.length} field${fields.length === 1 ? '' : 's'}`,
    `${filled} filled`,
    `${missing.length} required field${missing.length === 1 ? '' : 's'} still empty`,
  ];
  if (required.length) parts.push(`${required.length} required in total`);
  if (unsupported) parts.push(`${unsupported} cannot be filled in the app`);
  return parts.join(', ') + '.';
}

/**
 * Read the first bytes of a PDF as a latin-1 string without Node's
 * Buffer: this module also runs in the renderer, where Buffer does not
 * exist. Chunked so a large slice cannot overflow the argument stack.
 */
function pdfBytesToLatin1(bytes: Uint8Array, maxLength: number): string {
  const view = bytes.subarray(0, Math.min(bytes.byteLength, maxLength));
  let text = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunk) {
    text += String.fromCharCode(...view.subarray(offset, offset + chunk));
  }
  return text;
}

/**
 * Detect XFA in a PDF's bytes: the document has an AcroForm dictionary
 * and one of its objects references /XFA. The scan is bounded to object
 * bodies so a stray "/XFA" in page content cannot trigger it.
 */
export function detectPdfXfa(bytes: Uint8Array): boolean {
  if (!detectPdfAcroForm(bytes)) return false;
  const source = pdfBytesToLatin1(bytes, 4 * 1024 * 1024);
  for (const match of source.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)endobj\b/g)) {
    if (/\/XFA\b/.test(match[1])) return true;
  }
  return false;
}

/** True when the bytes hold an AcroForm dictionary at all (fillable or XFA). */
export function detectPdfAcroForm(bytes: Uint8Array): boolean {
  const source = pdfBytesToLatin1(bytes, 4 * 1024 * 1024);
  return /\/AcroForm\b/.test(source);
}
