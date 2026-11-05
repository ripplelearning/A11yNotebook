import { describe, expect, it } from 'vitest';
import {
  BIBLIOGRAPHY_HANGING_INDENT,
  sanitizeNoteHtml,
} from '../renderer/features/vault/sanitize-html';

describe('note HTML sanitizer and bibliography styles', () => {
  it('keeps the hanging indent and drops every other inline style', () => {
    const safe = sanitizeNoteHtml(
      `<p style="${BIBLIOGRAPHY_HANGING_INDENT}">Hanging</p><p style="color: red;">Red</p><p style="display: none;">Hidden</p>`,
    );
    expect(safe).toContain(BIBLIOGRAPHY_HANGING_INDENT);
    expect(safe).not.toContain('color: red');
    expect(safe).not.toContain('display: none');
  });

  it('keeps a full bibliography block and drops every other inline style', () => {
    const safe = sanitizeNoteHtml(
      '<p style="text-align: center; font-weight: bold; font-family: \'Times New Roman\', serif; font-size: 12pt;">References</p>' +
        '<p style="padding-left: 0.5in; text-indent: -0.5in; line-height: 2; margin: 0; font-family: \'Times New Roman\', serif; font-size: 12pt;">Entry</p>' +
        '<p style="color: red;">Red</p><p style="font-size: 14pt;">Big</p><p style="display: none;">Hidden</p>',
    );
    expect(safe).toContain('text-align: center');
    expect(safe).toContain('font-weight: bold');
    expect(safe).toContain("font-family: 'Times New Roman', serif");
    expect(safe).toContain('font-size: 12pt');
    expect(safe).toContain('line-height: 2');
    expect(safe).toContain('margin: 0');
    expect(safe).not.toContain('color: red');
    expect(safe).not.toContain('font-size: 14pt');
    expect(safe).not.toContain('display: none');
  });

  it('drops a style that mixes a bibliography declaration with another style', () => {
    const safe = sanitizeNoteHtml('<p style="padding-left: 0.5in; text-indent: -0.5in; color: red;">Mixed</p>');
    expect(safe).not.toContain('padding-left');
    expect(safe).not.toContain('color: red');
  });

  it('keeps a spacing variant of the hanging indent', () => {
    const safe = sanitizeNoteHtml('<p style="padding-left:0.5in;text-indent:-0.5in;">Hanging</p>');
    expect(safe).toContain('padding-left:');
    expect(safe).toContain('text-indent:');
  });
});
