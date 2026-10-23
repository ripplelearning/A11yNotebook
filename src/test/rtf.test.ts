import { describe, expect, it } from 'vitest';
import { convertRtfToHtml, isRtfSource } from '../../electron/vault/rtf';

const HEADER = '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}';

describe('RTF to HTML conversion', () => {
  it('recognizes RTF sources', () => {
    expect(isRtfSource('{\\rtf1\\ansi text}')).toBe(true);
    expect(isRtfSource('just text')).toBe(false);
    expect(() => convertRtfToHtml('just text')).toThrow(/not an RTF document/);
  });

  it('converts paragraphs and skips the font table', () => {
    const html = convertRtfToHtml(`${HEADER}\\pard First paragraph.\\par Second paragraph.\\par}`);
    expect(html).toBe('<p>First paragraph.</p>\n<p>Second paragraph.</p>');
    expect(html).not.toContain('Calibri');
  });

  it('converts bold, italic, underline, and line breaks', () => {
    const html = convertRtfToHtml(
      `${HEADER}\\pard A \\b bold\\b0, \\i italic\\i0, and \\ul underlined\\ulnone word.\\line Next line.\\par}`,
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>underlined</u>');
    expect(html).toContain('word.<br>Next line.');
  });

  it('decodes cp1252 escapes and unicode escapes', () => {
    const html = convertRtfToHtml(`${HEADER}\\pard \\'93Smart quotes\\'94 and caf\\u233? plus caf\\'e9.\\par}`);
    expect(html).toContain('“Smart quotes” and café plus café.');
  });

  it('maps stylesheet heading styles to real headings', () => {
    const source =
      '{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1 heading 1;}{\\s2 heading 2;}}' +
      '\\pard\\s1 Chapter One\\par\\pard\\s2 Section A\\par\\pard\\s0 Body text.\\par}';
    expect(convertRtfToHtml(source)).toBe('<h1>Chapter One</h1>\n<h2>Section A</h2>\n<p>Body text.</p>');
  });

  it('converts hyperlink fields into links and rejects script URLs', () => {
    const good = convertRtfToHtml(
      `${HEADER}\\pard See {\\field{\\*\\fldinst HYPERLINK "https://example.org"}{\\fldrslt Example Site}} for details.\\par}`,
    );
    expect(good).toContain('<a href="https://example.org">Example Site</a>');
    const bad = convertRtfToHtml(
      `${HEADER}\\pard {\\field{\\*\\fldinst HYPERLINK "javascript:alert(1)"}{\\fldrslt Click}}\\par}`,
    );
    expect(bad).not.toContain('javascript:');
    expect(bad).not.toContain('<a ');
  });

  it('groups bullet paragraphs into a list', () => {
    const source =
      HEADER +
      "\\pard{\\pntext\\f0\\'B7\\tab}First item\\par" +
      "\\pard{\\pntext\\f0\\'B7\\tab}Second item\\par" +
      '\\pard After the list.\\par}';
    const html = convertRtfToHtml(source);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>First item</li>');
    expect(html).toContain('<li>Second item</li>');
    expect(html).toContain('</ul>\n<p>After the list.</p>');
  });

  it('escapes text that looks like markup', () => {
    const html = convertRtfToHtml(`${HEADER}\\pard 1 < 2 & "quoted"\\par}`);
    expect(html).toBe('<p>1 &lt; 2 &amp; "quoted"</p>');
  });
});
