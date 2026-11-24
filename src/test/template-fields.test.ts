// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  fillTemplateFields,
  hasFilledTemplateValues,
  isTemplateNotePath,
  parseTemplateFields,
} from '../shared/template-fields';

describe('parseTemplateFields', () => {
  it('turns unknown placeholders into fields and skips the six known ones', () => {
    const fields = parseTemplateFields(
      '# {{title}}\n\nClient: {{Client Name}}\nDate: {{date}} at {{time}} ({{weekday}}) in {{notebook}}\n\n{{cursor}}',
      'markdown',
    );
    expect(fields).toEqual([{ name: 'Client Name', label: 'Client Name', index: 0 }]);
  });

  it('treats a typo of a known placeholder as a field', () => {
    const fields = parseTemplateFields('Date: {{dat}}\nName: {{Client Name}}', 'markdown');
    expect(fields.map((field) => field.name)).toEqual(['dat', 'Client Name']);
  });

  it('numbers repeated names and keeps them independent', () => {
    const fields = parseTemplateFields(
      'First: {{Client Name}}\nSecond: {{Client Name}}\nOther: {{Project}}',
      'markdown',
    );
    expect(fields).toEqual([
      { name: 'Client Name', label: 'Client Name 1', index: 0 },
      { name: 'Client Name', label: 'Client Name 2', index: 1 },
      { name: 'Project', label: 'Project', index: 2 },
    ]);
  });

  it('trims the name and skips empty placeholders', () => {
    const fields = parseTemplateFields('A {{  Client Name  }} and {{}} and {{ }} end', 'markdown');
    expect(fields).toEqual([{ name: 'Client Name', label: 'Client Name', index: 0 }]);
  });

  it('skips placeholders inside fenced code blocks and inline code', () => {
    const fields = parseTemplateFields(
      'Fill {{Real}} in.\n\n```\n{{Code Example}}\n```\n\nAlso `{{Inline}}` stays literal.\n\n~~~md\n{{Tilde Fence}}\n~~~\n',
      'markdown',
    );
    expect(fields.map((field) => field.name)).toEqual(['Real']);
  });

  it('skips placeholders inside HTML tags but keeps them in HTML text', () => {
    const fields = parseTemplateFields('<p title="{{Tooltip}}">Name: {{Client Name}}</p>', 'html');
    expect(fields.map((field) => field.name)).toEqual(['Client Name']);
  });

  it('keeps placeholders inside raw HTML in Markdown text, matching the reading view', () => {
    // Markdown rendering escapes raw HTML, so a marker inside a tag in a
    // Markdown note still renders as visible text.
    const fields = parseTemplateFields('<p title="{{Tooltip}}">Name: {{Client Name}}</p>', 'markdown');
    expect(fields.map((field) => field.name)).toEqual(['Tooltip', 'Client Name']);
  });
});

describe('fillTemplateFields', () => {
  it('bakes values in order and leaves known placeholders untouched', () => {
    const filled = fillTemplateFields(
      '# {{title}}\n\nClient: {{Client Name}}\nDate: {{date}}',
      ['Ada Lovelace'],
      'markdown',
    );
    expect(filled).toBe('# {{title}}\n\nClient: Ada Lovelace\nDate: {{date}}');
  });

  it('leaves a field marker in place when its value is null', () => {
    const filled = fillTemplateFields('First: {{Client Name}}\nSecond: {{Client Name}}', ['Ada', null], 'markdown');
    expect(filled).toBe('First: Ada\nSecond: {{Client Name}}');
  });

  it('bakes duplicate names independently', () => {
    const filled = fillTemplateFields('First: {{Client Name}}\nSecond: {{Client Name}}', ['Ada', 'Grace'], 'markdown');
    expect(filled).toBe('First: Ada\nSecond: Grace');
  });

  it('never replaces a marker inside a fenced block or inline code', () => {
    const filled = fillTemplateFields(
      'Fill {{Real}} in.\n\n```\n{{Code Example}}\n```\n\nAlso `{{Inline}}` stays.',
      ['Ada'],
      'markdown',
    );
    expect(filled).toBe('Fill Ada in.\n\n```\n{{Code Example}}\n```\n\nAlso `{{Inline}}` stays.');
  });

  it('never replaces a marker inside an HTML attribute', () => {
    const filled = fillTemplateFields('<p title="{{Tooltip}}">Name: {{Client Name}}</p>', ['Ada'], 'html');
    expect(filled).toBe('<p title="{{Tooltip}}">Name: Ada</p>');
  });
});

describe('isTemplateNotePath', () => {
  it('matches notes directly under the Templates folder', () => {
    expect(isTemplateNotePath('Templates/Daily.md')).toBe(true);
    expect(isTemplateNotePath('Templates/Intake/Client.md')).toBe(true);
    expect(isTemplateNotePath('Notes/Templates/Daily.md')).toBe(false);
    expect(isTemplateNotePath('Templates')).toBe(false);
    expect(isTemplateNotePath('Daily.md')).toBe(false);
  });
});

describe('hasFilledTemplateValues', () => {
  it('is true only when at least one value has non-blank text', () => {
    expect(hasFilledTemplateValues([])).toBe(false);
    expect(hasFilledTemplateValues([null, '   ', undefined])).toBe(false);
    expect(hasFilledTemplateValues(['', 'Ada'])).toBe(true);
  });
});
