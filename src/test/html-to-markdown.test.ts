import { describe, expect, it } from 'vitest';
import { htmlPlainText, htmlToMarkdown } from '../renderer/features/vault/html-to-markdown';

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    expect(htmlToMarkdown('<h1>Title</h1><p>First paragraph.</p><h2>Section</h2><p>Second.</p>')).toBe(
      '# Title\n\nFirst paragraph.\n\n## Section\n\nSecond.',
    );
  });

  it('converts nested lists with ordered numbering', () => {
    expect(
      htmlToMarkdown(
        '<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>',
      ),
    ).toBe('- One\n  - Nested\n- Two\n\n1. First\n2. Second');
  });

  it('converts tables to GitHub-flavored Markdown and escapes pipes', () => {
    expect(
      htmlToMarkdown(
        '<table><tr><th>Name</th><th>Value</th></tr><tr><td>A | B</td><td>1</td></tr><tr><td>C</td><td>2</td></tr></table>',
      ),
    ).toBe('| Name | Value |\n| --- | --- |\n| A \\| B | 1 |\n| C | 2 |');
  });

  it('keeps links, emphasis, code, and blockquotes', () => {
    expect(
      htmlToMarkdown(
        '<p>See <a href="https://example.com">the guide</a> and <strong>bold</strong> with <em>italic</em> and <code>code</code>.</p><blockquote><p>Quoted line</p></blockquote>',
      ),
    ).toBe(
      'See [the guide](https://example.com) and **bold** with *italic* and `code`.\n\n> Quoted line',
    );
  });

  it('keeps web images as Markdown images and drops data-URL images', () => {
    expect(
      htmlToMarkdown(
        '<p><img src="https://example.com/cat.png" alt="A cat"> and <img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline"></p>',
      ),
    ).toBe('![A cat](https://example.com/cat.png) and');
  });

  it('drops scripts, forms, and other elements with no Markdown equivalent', () => {
    expect(
      htmlToMarkdown(
        '<p>Keep this.</p><script>alert("no")</script><form><button>Press</button></form><svg><circle /></svg>',
      ),
    ).toBe('Keep this.');
  });

  it('converts fenced code blocks and horizontal rules', () => {
    expect(htmlToMarkdown('<pre>const x = 1;\nconst y = 2;</pre><hr><p>After.</p>')).toBe(
      '```\nconst x = 1;\nconst y = 2;\n```\n\n---\n\nAfter.',
    );
  });
});

describe('htmlPlainText', () => {
  it('keeps a line break after each block', () => {
    expect(htmlPlainText('<h1>Title</h1><p>First line.</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'Title\nFirst line.\nOne\nTwo',
    );
  });

  it('skips scripts and styles', () => {
    expect(htmlPlainText('<p>Visible</p><script>hidden()</script><style>.x{}</style>')).toBe('Visible');
  });
});
