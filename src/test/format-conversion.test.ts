import { describe, expect, it } from 'vitest';
import { convertNoteContent, formatConversionWarning } from '../renderer/features/vault/format-conversion';

describe('note format conversion', () => {
  it('converts Markdown into sanitized HTML while preserving semantic structure', () => {
    const html = convertNoteContent('# Heading\n\n**Important**', 'markdown', 'html', 'Notes/Entry.html');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Important</strong>');
    expect(html).not.toContain('<script');
  });

  it('converts the supported HTML subset to Markdown and identifies likely losses', () => {
    const markdown = convertNoteContent(
      '<h1>Heading</h1><p><strong>Important</strong></p><script>bad()</script>',
      'html',
      'markdown',
      'Notes/Entry.md',
    );
    expect(markdown).toContain('# Heading');
    expect(markdown).toContain('**Important**');
    expect(markdown).not.toContain('bad()');
    expect(
      formatConversionWarning('<h1 style="color:red">Title</h1><script>bad()</script>', 'html', 'markdown'),
    ).toContain('CSS classes, inline styling');
  });

  it('warns that conversion keeps a sibling copy and may not preserve unsupported syntax', () => {
    const warning = formatConversionWarning('<custom-widget>data</custom-widget>', 'html', 'markdown');
    expect(warning).toContain('sibling copy');
    expect(warning).toContain('original');
    expect(warning).toMatch(/unsupported formatting/i);
  });
});
