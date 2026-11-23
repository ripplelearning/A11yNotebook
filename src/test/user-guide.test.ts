import { describe, expect, it } from 'vitest';
import { getKeyboardShortcuts } from '../shared/command-registry';
import {
  buildGuideMarkdown,
  buildShortcutsSectionMarkdown,
  extractGuideSections,
  filterGuideSections,
  GUIDE_SHORTCUTS_HEADING,
  GUIDE_SHORTCUTS_MARKER,
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
    expect(body).toContain(GUIDE_SHORTCUTS_MARKER);
    expect(body).toContain('| User Guide | F1 |');
    expect(body).toContain('| Focus search | Alt+Q |');
    expect(body).toContain('generated from the command registry');
  });
});

describe('buildGuideMarkdown', () => {
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
