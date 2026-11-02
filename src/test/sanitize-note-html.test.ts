import { describe, expect, it } from 'vitest';
import {
  BIBLIOGRAPHY_HANGING_INDENT,
  sanitizeNoteHtml,
} from '../renderer/features/vault/sanitize-html';

describe('note HTML sanitizer and the bibliography hanging indent', () => {
  it('keeps the hanging indent and drops every other inline style', () => {
    const safe = sanitizeNoteHtml(
      `<p style="${BIBLIOGRAPHY_HANGING_INDENT}">Hanging</p><p style="color: red;">Red</p><p style="display: none;">Hidden</p>`,
    );
    expect(safe).toContain(BIBLIOGRAPHY_HANGING_INDENT);
    expect(safe).not.toContain('color: red');
    expect(safe).not.toContain('display: none');
  });

  it('keeps a spacing variant of the hanging indent', () => {
    const safe = sanitizeNoteHtml('<p style="padding-left:0.5in;text-indent:-0.5in;">Hanging</p>');
    expect(safe).toContain('padding-left:');
    expect(safe).toContain('text-indent:');
  });
});
