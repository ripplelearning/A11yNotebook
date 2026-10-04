import { describe, expect, it } from 'vitest';
import { convertNoteContent, formatConversionWarning } from '../renderer/features/vault/format-conversion';
import { sanitizeNoteHtml } from '../renderer/features/vault/sanitize-html';

describe('note format conversion', () => {
  it('converts Markdown into sanitized HTML while preserving semantic structure', () => {
    const html = convertNoteContent(
      '# Heading\n\n**Important**\n\n[[Linked note|Link label]]',
      'markdown',
      'html',
      'Notes/Entry.html',
    );
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Important</strong>');
    expect(html).toContain('<a href="#wiki:Linked%20note">Link label</a>');
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

  it('escapes backslashes in plain HTML text when converting to Markdown', () => {
    const markdown = convertNoteContent('<p>Folder \\path\\file</p>', 'html', 'markdown', 'Notes/Entry.md');
    expect(markdown).toBe('Folder \\\\path\\\\file');
  });

  it('uses a longer code fence when code contains backticks and preserves backslashes', () => {
    const markdown = convertNoteContent('<p><code>path\\with `ticks`</code></p>', 'html', 'markdown', 'Notes/Entry.md');
    expect(markdown).toBe('`` path\\with `ticks` ``');
  });

  it('warns that conversion keeps a sibling copy and may not preserve unsupported syntax', () => {
    const warning = formatConversionWarning('<custom-widget>data</custom-widget>', 'html', 'markdown');
    expect(warning).toContain('sibling copy');
    expect(warning).toContain('original');
    expect(warning).toMatch(/unsupported formatting/i);
  });

  it('removes form controls instead of injecting unlabeled controls into rendered notes', () => {
    const safe = sanitizeNoteHtml('<form><label>Input <input value="unsafe"></label><button>Run</button></form>');
    expect(safe).not.toMatch(/<(?:form|input|button)\b/i);
    expect(safe).toContain('Input');
  });
});
