import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES, expandTemplate, templateNotePath, validateNoteTitle } from '../shared/templates';

const now = new Date(2026, 9, 3, 9, 5);

describe('template expansion', () => {
  it('expands local date, time, title, notebook, and weekday with exact cursor offset', () => {
    const expanded = expandTemplate('{{title}} {{date}} {{time}} {{weekday}} {{notebook}} {{cursor}}hello', {
      title: 'My note',
      notebook: 'Work',
      now,
    });
    expect(expanded.content).toBe('My note 2026-10-03 09:05 Saturday Work hello');
    expect(expanded.content.slice(expanded.cursor)).toBe('hello');
  });

  it('does not recursively expand injected placeholders and preserves unknown tokens', () => {
    expect(
      expandTemplate('{{title}} {{unknown}} {{cursor}}a{{cursor}}b', { title: '{{date}}', notebook: '', now }),
    ).toEqual({
      content: '{{date}} {{unknown}} ab',
      cursor: 21,
    });
  });

  it('uses end-of-content when no cursor token is present and textarea UTF-16 offsets', () => {
    expect(expandTemplate('😀{{cursor}}x', { title: '', notebook: '', now }).cursor).toBe(2);
    expect(expandTemplate('hello', { title: '', notebook: '', now })).toEqual({ content: 'hello', cursor: 5 });
  });

  it('provides all five built-in templates with a usable cursor', () => {
    expect(BUILT_IN_TEMPLATES.map((template) => template.name)).toEqual([
      'Daily',
      'Meeting',
      'Project',
      'Reading',
      'Lecture',
    ]);
    for (const template of BUILT_IN_TEMPLATES) {
      const expanded = expandTemplate(template.content, { title: 'Test', notebook: 'Work', now });
      expect(expanded.content).toContain('# Test');
      expect(expanded.content).not.toContain('{{');
      expect(expanded.cursor).toBeGreaterThan(0);
      expect(expanded.cursor).toBeLessThanOrEqual(expanded.content.length);
    }
  });
});

describe('template note file names', () => {
  it.each([
    '',
    ' ',
    '../escape',
    'a\\b',
    'bad:title',
    'CON',
    'nul.md',
    'COM1.txt',
    'trailing.',
    'trailing ',
    'bad\u0000name',
  ])('rejects %j', (title) => {
    expect(validateNoteTitle(title)).not.toBeNull();
    expect(() => templateNotePath('Work', title)).toThrow();
  });

  it('appends a Markdown extension only when needed', () => {
    expect(templateNotePath('Work', 'Idea')).toBe('Work/Idea.md');
    expect(templateNotePath('Work/', 'Idea.MD')).toBe('Work/Idea.MD');
    expect(templateNotePath('', 'Idea.md')).toBe('Idea.md');
    expect(validateNoteTitle('日本語 notes')).toBeNull();
    expect(validateNoteTitle('x'.repeat(201))).not.toBeNull();
  });
});
