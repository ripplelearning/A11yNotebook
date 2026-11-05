// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeHtmlFragment, standaloneHtml } from '../../electron/vault/html-sanitize';

describe('main-process standalone HTML sanitization', () => {
  it('keeps semantic structures and task metadata but removes active content and remote resources', () => {
    const safe = sanitizeHtmlFragment(
      '<h1 onclick="run()">Title</h1><script><img src="https://bad.example/x.png"></script><form><input></form><p><a href="javascript:run()">Text</a></p><img src="https://bad.example/p.png" alt="Remote"><ul><li data-a11y-task-id="task-1234" data-a11y-task-complete="false" onmouseover="run()">Item</li></ul>',
    );
    expect(safe).toContain('<h1>Title</h1>');
    expect(safe).toContain('data-a11y-task-id="task-1234"');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('<form');
    expect(safe).not.toContain('javascript:');
    expect(safe).not.toContain('https://bad.example');
    expect(safe).not.toContain('onmouseover');
  });

  it('canonicalizes captured links and localizes only downloaded raster images', () => {
    const safe = sanitizeHtmlFragment(
      '<h2>News</h2><table><tbody><tr><th scope="col">Name</th><td>Value</td></tr></tbody></table><a href="../source">Source</a><img src="/photo.png" alt="Photo"><img src="https://remote.example/unknown.png" alt="Missing">',
      {
        allowVaultImages: true,
        baseUrl: 'https://example.org/articles/page',
        imageReferences: new Map([['https://example.org/photo.png', 'Attachments/Capture/image.png']]),
      },
    );
    expect(safe).toContain('<a href="https://example.org/source">');
    expect(safe).toContain('src="Attachments/Capture/image.png"');
    expect(safe).toContain('Missing');
    expect(safe).not.toContain('https://remote.example');
    expect(safe).toContain('<table>');
  });

  it('keeps MathML and its alttext in exported HTML, and drops other attributes', () => {
    const safe = sanitizeHtmlFragment(
      '<p><math alttext="frac(1,2)" display="block" onclick="run()"><mfrac><mn>1</mn><mn>2</mn></mfrac></math></p>',
    );
    expect(safe).toContain('<math alttext="frac(1,2)" display="block">');
    expect(safe).toContain('<mfrac>');
    expect(safe).not.toContain('onclick');
  });

  it('wraps output in a restrictive policy without scripts or network resources', () => {
    const output = standaloneHtml('Research <note>', sanitizeHtmlFragment('<p>Safe</p>'));
    expect(output).toContain("default-src 'none'");
    expect(output).toContain('<title>Research &lt;note&gt;</title>');
    expect(output).toContain('<p>Safe</p>');
  });

  it('keeps only the bibliography hanging indent and drops every other inline style', () => {
    const safe = sanitizeHtmlFragment(
      '<p style="padding-left: 0.5in; text-indent: -0.5in;">Hanging</p><p style="color: red;">Red</p><p style="display: none;">Hidden</p>',
    );
    expect(safe).toContain('padding-left: 0.5in; text-indent: -0.5in;');
    expect(safe).not.toContain('color: red');
    expect(safe).not.toContain('display: none');
  });

  it('keeps bibliography heading and entry styles and drops every other inline style', () => {
    const safe = sanitizeHtmlFragment(
      '<p style="text-align: center; font-weight: bold; font-family: \'Times New Roman\', serif; font-size: 12pt;">References</p>' +
        '<p style="padding-left: 0.5in; text-indent: -0.5in; line-height: 1; margin: 0 0 12pt; font-family: \'Times New Roman\', serif; font-size: 12pt;">Entry</p>' +
        '<p style="color: red;">Red</p><p style="padding-left: 0.5in; color: red;">Mixed</p>',
    );
    expect(safe).toContain('text-align: center');
    expect(safe).toContain('font-weight: bold');
    expect(safe).toContain('line-height: 1');
    expect(safe).toContain('margin: 0 0 12pt');
    // The main-process sanitizer escapes quotes in attribute values.
    expect(safe).toContain('font-family: &#39;Times New Roman&#39;, serif');
    expect(safe).not.toContain('color: red');
  });

  it('keeps footnote markers, ids, and classes but drops other ids and classes', () => {
    const safe = sanitizeHtmlFragment(
      '<p>Text<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup></p>' +
        '<section class="footnotes"><ol class="footnotes-list">' +
        '<li id="fn1" class="footnote-item"><p>Alex Rivera, <em>Accessible Design</em>. <a href="#fnref1" class="footnote-backref">↩</a></p></li>' +
        '</ol></section>' +
        '<p id="other" class="custom">Plain</p>',
    );
    expect(safe).toContain('<sup class="footnote-ref">');
    expect(safe).toContain('id="fnref1"');
    expect(safe).toContain('<section class="footnotes">');
    expect(safe).toContain('<li id="fn1" class="footnote-item">');
    expect(safe).toContain('class="footnote-backref"');
    expect(safe).not.toContain('id="other"');
    expect(safe).not.toContain('class="custom"');
  });
});
