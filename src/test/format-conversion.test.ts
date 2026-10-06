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

  it('preserves checklist completion, due dates, and priorities across format conversion', () => {
    const html = convertNoteContent('- [x] Read chapter due:2026-10-05 priority:high', 'markdown', 'html', 'Read.html');
    expect(html).toMatch(/data-a11y-task-complete="true"/);
    expect(html).toMatch(/data-a11y-task-due="2026-10-05"/);
    expect(html).toMatch(/data-a11y-task-priority="high"/);
    expect(html).not.toContain('[x]');
    expect(convertNoteContent(html, 'html', 'markdown', 'Read.md')).toContain(
      '- [x] Read chapter due:2026-10-05 priority:high',
    );
    expect(formatConversionWarning(html, 'html', 'markdown')).toContain('task identities');
  });

  it('escapes backslashes in plain HTML text when converting to Markdown', () => {
    const markdown = convertNoteContent('<p>Folder \\path\\file</p>', 'html', 'markdown', 'Notes/Entry.md');
    expect(markdown).toBe('Folder \\\\path\\\\file');
  });

  it('preserves stable task IDs and reminders through a Markdown/HTML round trip', () => {
    const source = '- [ ] Read remind:2026-10-05 09:30 <!-- a11y-task-id:stable-task-1234 -->';
    const html = convertNoteContent(source, 'markdown', 'html', 'Read.html');
    expect(html).toContain('data-a11y-task-id="stable-task-1234"');
    expect(html).toContain('data-a11y-task-remind="2026-10-05 09:30"');
    expect(convertNoteContent(html, 'html', 'markdown', 'Read.md')).toContain(source);
    expect(formatConversionWarning(source, 'markdown', 'html')).toContain(
      'milestone associations remain with the original note',
    );
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

  it('preserves documented task metadata through sanitization', () => {
    const safe = sanitizeNoteHtml(
      '<ul><li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="2026-10-05" onclick="run()">Task</li></ul>',
      'Notes/Tasks.html',
    );
    expect(safe).toContain('data-a11y-task-id="task-1234"');
    expect(safe).toContain('data-a11y-task-complete="false"');
    expect(safe).not.toContain('onclick');
  });
});
