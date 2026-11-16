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

describe('pasted data-URL images', () => {
  const dataImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('drops a data-URL image by default, as editor pastes do', () => {
    const safe = sanitizeNoteHtml(`<p><img src="${dataImage}" alt="A dot"></p>`);
    expect(safe).not.toContain('data:image');
    expect(safe).not.toContain('<img');
  });

  it('keeps a data-URL image inline with its description when pasting into a notebook', () => {
    const safe = sanitizeNoteHtml(`<p><img src="${dataImage}" alt="A dot"></p>`, '', { keepDataImages: true });
    expect(safe).toContain('data:image/png;base64,');
    expect(safe).toContain('alt="A dot"');
  });

  it('gives a kept data-URL image an empty description when the source provides none', () => {
    const safe = sanitizeNoteHtml(`<p><img src="${dataImage}"></p>`, '', { keepDataImages: true });
    expect(safe).toContain('data:image/png;base64,');
    expect(safe).toContain('alt=""');
  });

  it('still drops a data-URL image that is not a picture', () => {
    const safe = sanitizeNoteHtml('<p><img src="data:text/html;base64,PGgxPmhpPC9oMT4=" alt="Not a picture"></p>', '', {
      keepDataImages: true,
    });
    expect(safe).not.toContain('data:text/html');
    expect(safe).not.toContain('<img');
  });
});
