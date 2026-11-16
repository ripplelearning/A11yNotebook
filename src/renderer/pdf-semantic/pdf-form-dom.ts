import {
  pdfFormFieldValue,
  validatePdfFormValue,
  type PdfFormField,
  type PdfFormValue,
  type PdfFormValues,
} from '../../shared/pdf-form';
import type { TextModel } from './text-model';
import { ViewportTransform } from './viewport-transform';

export interface PdfFormDomOptions {
  values: PdfFormValues;
  /** Field name → error message, shown beside the control. */
  errors: ReadonlyMap<string, string>;
  onChange: (name: string, value: PdfFormValue) => void;
}

const FIELD_BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote';

/** Unique-enough control ids within one page render. */
function controlId(field: PdfFormField, suffix = ''): string {
  const safe = field.name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'field';
  return `pdf-form-${field.page}-${safe}${suffix}`;
}

function buildLabel(doc: Document, field: PdfFormField, id: string): HTMLLabelElement {
  const label = doc.createElement('label');
  label.htmlFor = id;
  label.textContent = field.required ? `${field.label} (required)` : field.label;
  return label;
}

function buildError(doc: Document, field: PdfFormField, errors: ReadonlyMap<string, string>): HTMLParagraphElement {
  const error = doc.createElement('p');
  error.className = 'pdf-form-field-error';
  error.id = `${controlId(field, '-error')}`;
  const message = errors.get(field.name);
  if (message) {
    error.textContent = message;
  } else {
    error.hidden = true;
  }
  return error;
}

function applyValidity(control: HTMLElement, field: PdfFormField, errors: ReadonlyMap<string, string>): void {
  const message = errors.get(field.name);
  if (message) {
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', `${controlId(field, '-error')}`);
  } else {
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
}

function buildControl(doc: Document, field: PdfFormField, options: PdfFormDomOptions): HTMLElement {
  const value = pdfFormFieldValue(field, options.values);
  if (field.type === 'text') {
    const id = controlId(field);
    const wrapper = doc.createElement('div');
    wrapper.append(buildLabel(doc, field, id));
    const control = field.multiline ? doc.createElement('textarea') : doc.createElement('input');
    if (!field.multiline) {
      (control as HTMLInputElement).type = field.password ? 'password' : 'text';
    }
    control.id = id;
    control.value = typeof value === 'string' ? value : '';
    if (field.maxLength > 0) control.setAttribute('maxlength', String(field.maxLength));
    if (field.required) control.setAttribute('aria-required', 'true');
    if (field.readOnly) control.disabled = true;
    control.addEventListener('input', () => {
      options.onChange(field.name, control.value);
      applyValidity(control, field, options.errors);
    });
    applyValidity(control, field, options.errors);
    wrapper.append(control, buildError(doc, field, options.errors));
    return wrapper;
  }
  if (field.type === 'checkbox') {
    const id = controlId(field);
    const wrapper = doc.createElement('div');
    const control = doc.createElement('input');
    control.type = 'checkbox';
    control.id = id;
    control.checked = value === true;
    if (field.required) control.setAttribute('aria-required', 'true');
    if (field.readOnly) control.disabled = true;
    control.addEventListener('change', () => {
      options.onChange(field.name, control.checked);
      applyValidity(control, field, options.errors);
    });
    applyValidity(control, field, options.errors);
    wrapper.append(control, buildLabel(doc, field, id), buildError(doc, field, options.errors));
    return wrapper;
  }
  if (field.type === 'radio') {
    const group = doc.createElement('fieldset');
    const legend = doc.createElement('legend');
    legend.textContent = field.required ? `${field.label} (required)` : field.label;
    group.append(legend);
    const groupName = controlId(field, '-group');
    for (const option of field.options ?? []) {
      const id = `${controlId(field)}-${option.value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'option'}`;
      const choice = doc.createElement('div');
      const control = doc.createElement('input');
      control.type = 'radio';
      control.name = groupName;
      control.id = id;
      control.value = option.value;
      control.checked = value === option.value;
      if (field.required) control.setAttribute('aria-required', 'true');
      if (field.readOnly) control.disabled = true;
      control.addEventListener('change', () => {
        if (control.checked) options.onChange(field.name, option.value);
      });
      const label = doc.createElement('label');
      label.htmlFor = id;
      label.textContent = option.label || option.value;
      choice.append(control, label);
      group.append(choice);
    }
    if (field.required) group.setAttribute('aria-required', 'true');
    const error = buildError(doc, field, options.errors);
    group.append(error);
    return group;
  }
  if (field.type === 'dropdown') {
    const id = controlId(field);
    const wrapper = doc.createElement('div');
    wrapper.append(buildLabel(doc, field, id));
    const control = doc.createElement('select');
    control.id = id;
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose an option';
    control.append(placeholder);
    for (const option of field.options ?? []) {
      const element = doc.createElement('option');
      element.value = option.value;
      element.textContent = option.label || option.value;
      control.append(element);
    }
    control.value = typeof value === 'string' ? value : '';
    if (field.required) control.setAttribute('aria-required', 'true');
    if (field.readOnly) control.disabled = true;
    control.addEventListener('change', () => {
      options.onChange(field.name, control.value);
      applyValidity(control, field, options.errors);
    });
    applyValidity(control, field, options.errors);
    wrapper.append(control, buildError(doc, field, options.errors));
    return wrapper;
  }
  const note = doc.createElement('p');
  note.textContent = `${field.label}: ${field.unsupportedReason ?? 'This field cannot be filled in the app.'}`;
  return note;
}

/**
 * Insert one field's control into the semantic DOM, right after the text
 * block nearest the field's widget, so the field is filled in reading
 * order as the user reads the page. Fields with no nearby text land in a
 * "Form fields" section at the end of the page.
 */
export function insertFormFieldsIntoSemanticDOM(
  root: HTMLElement,
  fields: PdfFormField[],
  textModel: TextModel,
  view: [number, number, number, number],
  zoom: number,
  rotation: number,
  options: PdfFormDomOptions,
): void {
  if (!fields.length) return;
  const doc = root.ownerDocument ?? document;
  let fallbackSection: HTMLElement | null = null;
  for (const field of fields) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'pdf-form-field';
    wrapper.dataset.pdfFormField = field.name;
    wrapper.dataset.pdfFormFieldType = field.type;
    if (field.unlabeled) wrapper.dataset.pdfFormUnlabeled = 'true';
    wrapper.append(buildControl(doc, field, options));
    if (field.unlabeled) {
      const note = doc.createElement('p');
      note.textContent = 'This field has no label in the form; the field name is read aloud instead.';
      wrapper.append(note);
    }
    const [centerX, topY] = [(field.rect[0] + field.rect[2]) / 2, field.rect[3]];
    const [viewportX, viewportY] = new ViewportTransform(view, zoom, rotation).pdfPoint(centerX, topY);
    const offset = textModel.coordinatesToOffset(viewportX, viewportY, zoom, rotation);
    let placed = false;
    if (offset !== null) {
      const span = [...root.querySelectorAll<HTMLElement>('[data-start-offset]')].find(
        (candidate) => Number(candidate.dataset.startOffset) <= offset && Number(candidate.dataset.endOffset) > offset,
      );
      const block = span?.closest<HTMLElement>(FIELD_BLOCK_SELECTOR);
      if (block && block !== root && root.contains(block)) {
        block.after(wrapper);
        placed = true;
      }
    }
    if (!placed) {
      if (!fallbackSection) {
        fallbackSection = doc.createElement('section');
        fallbackSection.setAttribute('aria-label', 'Form fields');
        const heading = doc.createElement('h4');
        heading.textContent = 'Form fields';
        fallbackSection.append(heading);
        root.append(fallbackSection);
      }
      fallbackSection.append(wrapper);
    }
  }
}

/**
 * Bring already-rendered inline controls up to date with the stored
 * values and errors without rebuilding the page: used when values finish
 * loading after the page rendered, and after a reset.
 */
export function syncFormFieldValues(
  root: HTMLElement,
  fields: PdfFormField[],
  values: PdfFormValues,
  errors: ReadonlyMap<string, string>,
): void {
  for (const field of fields) {
    const wrapper = root.querySelector<HTMLElement>(`[data-pdf-form-field="${CSS.escape(field.name)}"]`);
    if (!wrapper) continue;
    const value = pdfFormFieldValue(field, values);
    const error = wrapper.querySelector<HTMLElement>('.pdf-form-field-error');
    const message = errors.get(field.name) ?? validatePdfFormValue(field, value);
    if (error) {
      if (message) {
        error.textContent = message;
        error.hidden = false;
      } else {
        error.textContent = '';
        error.hidden = true;
      }
    }
    if (field.type === 'checkbox') {
      const control = wrapper.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (control) {
        control.checked = value === true;
        applyValidity(control, field, errors);
      }
      continue;
    }
    if (field.type === 'radio') {
      for (const control of wrapper.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
        control.checked = control.value === value;
      }
      continue;
    }
    if (field.type === 'dropdown') {
      const control = wrapper.querySelector<HTMLSelectElement>('select');
      if (control) {
        control.value = typeof value === 'string' ? value : '';
        applyValidity(control, field, errors);
      }
      continue;
    }
    if (field.type === 'text') {
      const control = wrapper.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
      if (control) {
        control.value = typeof value === 'string' ? value : '';
        applyValidity(control, field, errors);
      }
    }
  }
}
