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

  it('renders exported task lines as enabled, checkable checkboxes', () => {
    const safe = sanitizeHtmlFragment(
      '<ul><li data-a11y-task-id="task-1234abcd" data-a11y-task-complete="false">Buy milk</li>' +
        '<li data-a11y-task-id="task-5678efgh" data-a11y-task-complete="true">Pay bill</li></ul>',
      { renderTaskControls: true },
    );
    const checkboxes = safe.match(/<input[^>]*type="checkbox"[^>]*>/gi) ?? [];
    expect(checkboxes).toHaveLength(2);
    // Exported checkboxes must be enabled: a disabled checkbox cannot be
    // checked or unchecked in the browser, so the exported task list is
    // read-only. The checked state still reflects the note.
    for (const checkbox of checkboxes) expect(checkbox).not.toContain('disabled');
    expect(checkboxes[0]).not.toContain('checked');
    expect(checkboxes[1]).toContain('checked');
    expect(checkboxes[0]).toContain('aria-label="Checklist item"');
    expect(safe).toContain('Buy milk');
    expect(safe).toContain('Pay bill');
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

describe('raw-text elements cannot corrupt the blocked-element stack', () => {
  it('keeps article text after a script that writes a script tag', () => {
    // The XDA capture shape: a script body containing a `<script>`
    // string whose close is backslash-escaped (`<\/script>`). The old
    // tag scanner pushed the inner `<script>` open but never popped it
    // (the escaped close is not a tag), so the stack stayed stuck and
    // the whole article body after it was swallowed.
    const safe = sanitizeHtmlFragment(
      '<html><head><title>Everyday tasks</title>' +
        `<script>document.write('<script src="a.js"><\\/script>');</script>` +
        '</head><body><h1>Everyday tasks</h1><article><p>Do the thing in a browser.</p></article></body></html>',
    );
    expect(safe).toContain('<h1>Everyday tasks</h1>');
    expect(safe).toContain('Do the thing in a browser.');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('document.write');
  });

  it('keeps text after a title containing a less-than sign', () => {
    // A literal `<` inside a title used to be read as a tag whose end
    // consumed the real `</title>`, so the title never closed and
    // everything after it was swallowed.
    const safe = sanitizeHtmlFragment('<title>5 < 10 things</title><p>Kept</p>');
    expect(safe).toContain('<p>Kept</p>');
    expect(safe).not.toContain('<title');
  });

  it('keeps text after a style block whose content looks like markup', () => {
    const safe = sanitizeHtmlFragment(
      '<style>a<b{color:red}</style><p>Kept</p><script>var x = "<div>";</script><p>Also kept</p>',
    );
    expect(safe).toContain('<p>Kept</p>');
    expect(safe).toContain('<p>Also kept</p>');
    expect(safe).not.toContain('<style');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('var x');
  });

  it('recovers after mismatched closes of blocked elements', () => {
    // A close tag for an element deeper in the stack still ends it
    // (and anything opened inside it), instead of leaving the stack
    // stuck and swallowing the rest of the document.
    const safe = sanitizeHtmlFragment(
      '<form><button>Label</form><p>After the form.</p><template><form></template><p>After the template.</p>',
    );
    expect(safe).toContain('After the form.');
    expect(safe).toContain('After the template.');
    expect(safe).not.toContain('<form');
    expect(safe).not.toContain('<button');
    expect(safe).not.toContain('<template');
    expect(safe).not.toContain('Label');
  });

  it('drops an unclosed script and everything after it', () => {
    const safe = sanitizeHtmlFragment('<p>Before</p><script>var x = 1;');
    expect(safe).toContain('<p>Before</p>');
    expect(safe).not.toContain('var x');
    expect(safe).not.toContain('<script');
  });

  it('still drops blocked content nested inside other blocked elements', () => {
    const safe = sanitizeHtmlFragment(
      '<head><noscript><form><input></form></noscript><script>steal()</script></head><p>Kept</p>',
    );
    expect(safe).toContain('<p>Kept</p>');
    expect(safe).not.toContain('<noscript');
    expect(safe).not.toContain('<form');
    expect(safe).not.toContain('steal()');
  });
});
