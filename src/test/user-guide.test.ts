import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getKeyboardShortcuts } from '../shared/command-registry';
import {
  buildGuideMarkdown,
  buildShortcutsSectionMarkdown,
  extractGuideSections,
  filterGuideSections,
  GUIDE_SHORTCUTS_HEADING,
  GUIDE_SHORTCUTS_MARKER,
  stripGuideHtmlComments,
} from '../shared/user-guide';

const SAMPLE = `# User guide

Intro text.

## Search

Find things with the search box.

### Search history

Past searches are remembered.

## Tasks

\`\`\`
## Not a heading
\`\`\`

Do work.
`;

describe('extractGuideSections', () => {
  it('splits on level-2 and level-3 headings, skipping the level-1 title and fenced code', () => {
    const sections = extractGuideSections(SAMPLE);
    expect(sections.map((section) => section.title)).toEqual(['Search', 'Search history', 'Tasks']);
    expect(sections.map((section) => section.level)).toEqual([2, 3, 2]);
    expect(sections.map((section) => section.id)).toEqual(['search', 'search-history', 'tasks']);
    expect(sections[0].markdown).toBe('## Search\n\nFind things with the search box.');
    expect(sections[2].markdown).toContain('## Not a heading');
    expect(sections[2].text).toContain('do work');
  });

  it('dedupes ids for repeated headings', () => {
    const sections = extractGuideSections('## Links\n\nA.\n\n## Links\n\nB.\n');
    expect(sections.map((section) => section.id)).toEqual(['links', 'links-2']);
  });

  it('keeps a headingless document as one section', () => {
    const sections = extractGuideSections('Just prose, no headings.');
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('guide');
  });
});

describe('buildShortcutsSectionMarkdown', () => {
  it('renders one table row per shortcut row', () => {
    const body = buildShortcutsSectionMarkdown([
      { label: 'User Guide', shortcut: 'F1' },
      { label: 'Focus search', shortcut: 'Alt+Q' },
    ]);
    // The generation marker lives in the guide file as an editor hint; it
    // must never reach the rendered guide, where it showed as visible text.
    expect(body).not.toContain(GUIDE_SHORTCUTS_MARKER);
    expect(body).not.toContain('<!--');
    expect(body).toContain('| User Guide | F1 |');
    expect(body).toContain('| Focus search | Alt+Q |');
    expect(body).toContain('generated from the command registry');
  });
});

describe('buildGuideMarkdown', () => {
  it('strips HTML comments from the rendered guide while keeping the shortcuts generated', () => {
    const source = [
      '# User guide',
      '',
      '## Search',
      '',
      'Find things.',
      '',
      '## Keyboard shortcuts',
      '',
      GUIDE_SHORTCUTS_MARKER,
      '',
      'Old table.',
      '',
      '## Accessibility notes',
      '',
      'Notes.',
      '',
    ].join('\n');
    const built = buildGuideMarkdown(source, [
      { label: 'User Guide', shortcut: 'F1' },
      { label: 'Focus search', shortcut: 'Alt+Q' },
    ]);
    // The marker comment showed as visible text in the guide (markdown-it
    // renders raw HTML as escaped text); the rendered guide must carry no
    // trace of it, while the shortcuts still come from the registry.
    expect(built).not.toContain('<!--');
    expect(built).not.toContain('guide-shortcuts:');
    expect(built).toContain(`## ${GUIDE_SHORTCUTS_HEADING}`);
    expect(built).toContain('| User Guide | F1 |');
    expect(built).toContain('| Focus search | Alt+Q |');
    expect(built).not.toContain('Old table.');
    expect(built).toContain('## Search\n\nFind things.');
    expect(built).toContain('## Accessibility notes\n\nNotes.');
  });

  it('replaces the hand-maintained shortcuts section and keeps the rest', () => {
    const source = [
      '# User guide',
      '',
      '## Search',
      '',
      'Find things.',
      '',
      '## Keyboard shortcuts',
      '',
      '| Shortcut | Action |',
      '| --- | --- |',
      '| F1 | Show keyboard shortcuts |',
      '| Alt+Q | Focus global search |',
      '',
      '## Accessibility notes',
      '',
      'Notes.',
      '',
    ].join('\n');
    const built = buildGuideMarkdown(source, [
      { label: 'User Guide', shortcut: 'F1' },
      { label: 'Focus search', shortcut: 'Alt+Q' },
    ]);
    // The stale hand table is gone; the generated table is in its place.
    expect(built).not.toContain('Show keyboard shortcuts');
    expect(built).not.toContain('Focus global search');
    expect(built).toContain(`## ${GUIDE_SHORTCUTS_HEADING}`);
    expect(built).toContain('| User Guide | F1 |');
    expect(built).toContain('| Focus search | Alt+Q |');
    // Surrounding sections survive verbatim.
    expect(built).toContain('## Search\n\nFind things.');
    expect(built).toContain('## Accessibility notes\n\nNotes.');
  });

  it('shows a remapped shortcut from the registry without anyone editing the guide', () => {
    const rows = getKeyboardShortcuts({ 'toggle-bookmark': 'Ctrl+Alt+T' });
    expect(rows).toContainEqual({
      commandId: 'toggle-bookmark',
      label: 'Toggle note bookmark',
      shortcut: 'Ctrl+Alt+T',
    });
    const built = buildGuideMarkdown('# Guide\n\n## Keyboard shortcuts\n\nOld table.\n', rows);
    expect(built).toContain('| Toggle note bookmark | Ctrl+Alt+T |');
    expect(built).not.toContain('Old table.');
    // A remapped command's default binding is gone from the generated table.
    expect(built).not.toMatch(/\| Toggle note bookmark \| Ctrl\+D \|/);
  });

  it('binds F1 to the User Guide and leaves the shortcuts dialog unbound', () => {
    const rows = getKeyboardShortcuts();
    expect(rows).toContainEqual({ commandId: 'show-user-guide', label: 'User Guide', shortcut: 'F1' });
    expect(rows.some((row) => row.commandId === 'show-keyboard-shortcuts')).toBe(false);
  });

  it('appends the generated section when the heading is missing', () => {
    const built = buildGuideMarkdown('# Guide\n\n## Search\n\nFind things.\n', [
      { label: 'User Guide', shortcut: 'F1' },
    ]);
    expect(built).toContain('## Search\n\nFind things.');
    expect(built).toContain(`## ${GUIDE_SHORTCUTS_HEADING}`);
    expect(built).toContain('| User Guide | F1 |');
  });
});

describe('filterGuideSections', () => {
  const sections = extractGuideSections(SAMPLE);

  it('returns every section for an empty query', () => {
    expect(filterGuideSections(sections, '  ')).toHaveLength(3);
  });

  it('matches case-insensitively on heading or body text', () => {
    expect(filterGuideSections(sections, 'REMEMBERED').map((section) => section.title)).toEqual(['Search history']);
    expect(filterGuideSections(sections, 'search').map((section) => section.title)).toEqual([
      'Search',
      'Search history',
    ]);
  });

  it('requires every query word to match', () => {
    expect(filterGuideSections(sections, 'search remembered')).toEqual([sections[1]]);
    expect(filterGuideSections(sections, 'search missing')).toEqual([]);
  });
});

describe('stripGuideHtmlComments', () => {
  it('removes comments outside fenced code but keeps them inside examples', () => {
    const markdown = [
      '## Tasks',
      '',
      '<!-- a note to editors -->',
      '',
      '```html',
      '<!-- a11y-task-id:task-1234 -->',
      '```',
      '',
      'Text <!-- inline note --> more text.',
      '',
    ].join('\n');
    const stripped = stripGuideHtmlComments(markdown);
    expect(stripped).not.toContain('a note to editors');
    expect(stripped).not.toContain('inline note');
    expect(stripped).toContain('<!-- a11y-task-id:task-1234 -->');
    expect(stripped).toContain('Text  more text.');
  });
});

describe('the shipped guide file', () => {
  const guideSource = readFileSync('docs/user-guide.md', 'utf8');
  const sections = extractGuideSections(buildGuideMarkdown(guideSource, getKeyboardShortcuts()));

  it('opens with the three introductory sections in order', () => {
    // The three parts are the first three top-level (level-2) sections;
    // the feature sections are their own part after them, as level-3
    // sections under "Features in detail".
    const topLevel = sections.filter((section) => section.level === 2);
    expect(topLevel.slice(0, 3).map((section) => section.title)).toEqual([
      'Introduction to A11y Notebook',
      'The user interface and how to navigate it using a keyboard',
      'Accessibility features and accessibility settings',
    ]);
    expect(sections[0].title).toBe('Introduction to A11y Notebook');
  });

  it('keeps the feature sections after the three introductory sections', () => {
    // The Introduction is short: no feature subsection sits inside it,
    // and every feature section comes after the accessibility section.
    expect(sections[0].markdown).not.toMatch(/^### /m);
    const topLevel = sections.filter((section) => section.level === 2);
    expect(topLevel.map((section) => section.title)).toEqual([
      'Introduction to A11y Notebook',
      'The user interface and how to navigate it using a keyboard',
      'Accessibility features and accessibility settings',
      'Features in detail',
    ]);
    const accessibilityIndex = sections.findIndex(
      (section) => section.title === 'Accessibility features and accessibility settings',
    );
    const tasksIndex = sections.findIndex((section) => section.title === 'Tasks');
    expect(tasksIndex).toBeGreaterThan(accessibilityIndex);
  });

  it('names the four view shortcuts in the user interface section', () => {
    const ui = sections.find(
      (section) => section.title === 'The user interface and how to navigate it using a keyboard',
    );
    expect(ui).toBeDefined();
    // The guide wraps lines, so compare against whitespace-normalized text.
    const text = ui?.markdown.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Ctrl+4 for Tasks');
    expect(text).toContain('Ctrl+5 for Cognitive Tools');
    expect(text).toContain('Ctrl+7 for Reminders');
    expect(text).toContain('Ctrl+0 for the Contents view');
  });

  it('keeps the shortcuts section generated from the registry at render time', () => {
    const shortcuts = sections.find((section) => section.title === 'Keyboard shortcuts');
    expect(shortcuts).toBeDefined();
    expect(shortcuts?.markdown).toContain('| User Guide | F1 |');
    // The generation marker stays in the file as an editor hint, but the
    // rendered guide never shows it.
    expect(guideSource).toContain('guide-shortcuts: generated');
    expect(shortcuts?.markdown).not.toContain('<!--');
    expect(shortcuts?.markdown).not.toContain('guide-shortcuts:');
  });

  it('shows task and reminder dates as MM/DD/YYYY, never YYYY-MM-DD', () => {
    expect(guideSource).not.toMatch(/due:\d{4}-\d{2}-\d{2}/);
    expect(guideSource).not.toMatch(/📅\s*\d{4}-\d{2}-\d{2}/);
    expect(guideSource).not.toMatch(/remind:\d{4}-\d{2}-\d{2}/);
    expect(guideSource).not.toMatch(/⏰\s*\d{4}-\d{2}-\d{2}/);
    expect(guideSource).not.toMatch(/data-a11y-task-due="\d{4}-\d{2}-\d{2}"/);
    expect(guideSource).not.toMatch(/data-a11y-task-remind="\d{4}-\d{2}-\d{2}/);
    expect(guideSource).toContain('due:10/05/2026');
    expect(guideSource).toContain('📅 10/05/2026');
    expect(guideSource).toContain('remind:10/04/2026 09:30');
    expect(guideSource).toContain('⏰ 10/04/2026 09:30');
    expect(guideSource).toContain('data-a11y-task-due="10/05/2026"');
  });
});
