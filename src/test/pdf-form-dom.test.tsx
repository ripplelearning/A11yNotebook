// @vitest-environment node
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PdfDocument } from '../renderer/pdf-semantic/pdf-document';
import { fillablePdfFixture } from './fixtures/fillable-pdf-fixture';

/**
 * Inline form controls in the reflowed reading view: fields render as
 * labelled controls placed after the text nearest the widget, and
 * changes flow back through the change callback with the stored values
 * applied.
 *
 * Runs in Node (where the pinned pdf.js build loads) with a JSDOM
 * document installed for the DOM the reflow view builds: jsdom itself
 * cannot set up the pdf.js worker.
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>');

describe('inline fillable PDF controls in the reading view', () => {
  beforeAll(() => {
    (globalThis as unknown as Record<string, unknown>).document = dom.window.document;
    (globalThis as unknown as Record<string, unknown>).CSS = dom.window.CSS;
    (globalThis as unknown as Record<string, unknown>).Event = dom.window.Event;
  });

  afterAll(() => {
    delete (globalThis as unknown as Record<string, unknown>).document;
    delete (globalThis as unknown as Record<string, unknown>).CSS;
    delete (globalThis as unknown as Record<string, unknown>).Event;
  });

  it('renders labelled controls inline and reports changes', async () => {
    const bytes = await fillablePdfFixture();
    const document = new PdfDocument(bytes, 'fillable-hash', 'Forms/fillable.pdf');
    try {
      await document.ready;
      const page = await document.getPage(1);
      const onChange = vi.fn();
      const root = page.getSemanticDOM(1, 0, undefined, {
        values: { fullName: 'Ada', agree: true, color: 'Blue', size: 'Small' },
        errors: new Map(),
        onChange,
      });
      dom.window.document.body.append(root);
      try {
        const nameInput = root.querySelector<HTMLInputElement>('input[type="text"]');
        expect(nameInput).not.toBeNull();
        expect(nameInput!.value).toBe('Ada');
        expect(nameInput!.labels?.[0]?.textContent).toContain('Your full name');
        expect(nameInput!.getAttribute('aria-required')).toBe('true');

        const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(true);
        expect(checkbox!.labels?.[0]?.textContent).toContain('I agree to the terms');

        const select = root.querySelector<HTMLSelectElement>('select');
        expect(select).not.toBeNull();
        expect(select!.value).toBe('Blue');
        expect(select!.labels?.[0]?.textContent).toContain('Favorite color:');

        const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        expect(radios).toHaveLength(2);
        expect(radios[0].checked).toBe(true);
        expect(radios[1].checked).toBe(false);
        const fieldset = radios[0].closest('fieldset');
        expect(fieldset?.querySelector('legend')?.textContent).toContain('Size:');

        // The controls sit inside the page's semantic DOM, after the
        // text blocks, not in a separate panel.
        const fieldWrappers = root.querySelectorAll('[data-pdf-form-field]');
        expect(fieldWrappers.length).toBe(6);
        expect(root.textContent).toContain('List boxes cannot be filled');
        expect(root.textContent).toContain('Buttons cannot be filled');

        // Typing reports the new value through the change callback.
        nameInput!.value = 'Grace';
        nameInput!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('fullName', 'Grace');
        checkbox!.checked = false;
        checkbox!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('agree', false);
      } finally {
        root.remove();
      }
    } finally {
      await document.destroy();
    }
  });
});
