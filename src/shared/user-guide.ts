/**
 * Helpers for the in-app User Guide (F1). The guide text lives in
 * docs/user-guide.md and is bundled into the renderer at build time; the
 * "Keyboard shortcuts" section is replaced at render time with a table
 * generated from the command registry, so a remapped or added shortcut
 * shows up without anyone editing the guide.
 *
 * This module is pure (no DOM, no React) so the section parsing and the
 * shortcuts replacement are unit-testable on their own.
 */

/** Heading of the generated shortcuts section in the guide. */
export const GUIDE_SHORTCUTS_HEADING = 'Keyboard shortcuts';

/**
 * Marker that heads the generated shortcuts section, in the guide file and
 * in the rendered guide alike: it tells the next editor the section is
 * not hand-maintained.
 */
export const GUIDE_SHORTCUTS_MARKER =
  '<!-- guide-shortcuts: generated from the command registry when the guide opens; do not hand-edit this section. -->';

export type GuideShortcutRow = { label: string; shortcut: string };

export interface GuideSection {
  /** Fragment id for the section heading (also its TOC target). */
  id: string;
  level: 2 | 3;
  title: string;
  /** Markdown of the section, including its heading line. */
  markdown: string;
  /** Plain-ish text of the section, for search matching. */
  text: string;
}

const HEADING_PATTERN = /^(##|###)\s+(.+?)\s*$/;

/** Turn a heading into a fragment id: lowercase words joined with dashes. */
export function slugifyGuideHeading(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function stripMarkdownForSearch(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[`*_#>|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Split guide markdown into one section per level-2 or level-3 heading.
 * The level-1 title is the dialog title, not a section. A section runs
 * from its heading to the next level-2 or level-3 heading (or the end),
 * so a level-3 subsection is its own searchable, linkable section.
 * Duplicate titles get suffixed ids (…-2, …-3) so every TOC target is
 * unique. Markdown with no level-2/3 headings becomes one section.
 */
export function extractGuideSections(markdown: string): GuideSection[] {
  const lines = markdown.split('\n');
  const starts: { index: number; level: 2 | 3; title: string }[] = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    // Headings inside fenced code blocks are examples, not sections.
    if (/^```/.test(lines[index])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING_PATTERN.exec(lines[index]);
    if (match) {
      starts.push({ index, level: match[1] === '##' ? 2 : 3, title: match[2] });
    }
  }
  if (starts.length === 0) {
    const text = stripMarkdownForSearch(markdown);
    return [{ id: 'guide', level: 2, title: 'User guide', markdown, text }];
  }
  const usedIds = new Map<string, number>();
  return starts.map((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : lines.length;
    // Drop trailing blank lines so a section's text ends on content.
    let last = end;
    while (last > start.index + 1 && lines[last - 1].trim() === '') last -= 1;
    const sectionMarkdown = lines.slice(start.index, last).join('\n');
    const baseId = slugifyGuideHeading(start.title);
    const count = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, count);
    return {
      id: count === 1 ? baseId : `${baseId}-${count}`,
      level: start.level,
      title: start.title,
      markdown: sectionMarkdown,
      text: stripMarkdownForSearch(sectionMarkdown),
    };
  });
}

/**
 * Build the shortcuts section body (without its heading) from the rows
 * the shortcuts dialog shows: navigation keys first, then every command
 * binding from the registry, in the caller's order.
 */
export function buildShortcutsSectionMarkdown(rows: readonly GuideShortcutRow[]): string {
  const intro =
    'The shortcuts below are always current: they are generated from the command registry when the guide opens, ' +
    'so a remapped or added shortcut appears here without anyone editing the guide.';
  const macNote = 'On macOS, use Command (⌘) in place of Ctrl and Option in place of Alt.';
  const table = [
    '| Action | Shortcut |',
    '| --- | --- |',
    ...rows.map((row) => `| ${row.label} | ${row.shortcut} |`),
  ].join('\n');
  return `${GUIDE_SHORTCUTS_MARKER}\n\n${intro}\n\n${macNote}\n\n${table}`;
}

/**
 * Replace the "Keyboard shortcuts" section of the guide source with the
 * generated table. The old section runs from its heading to the next
 * level-2 heading (or the end of the file); everything else is kept
 * verbatim. If the heading is missing, the generated section is appended,
 * so the guide never silently loses its shortcuts.
 */
export function buildGuideMarkdown(source: string, rows: readonly GuideShortcutRow[]): string {
  const lines = source.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim() === `## ${GUIDE_SHORTCUTS_HEADING}`);
  const generated = `## ${GUIDE_SHORTCUTS_HEADING}\n\n${buildShortcutsSectionMarkdown(rows)}`;
  if (headingIndex === -1) {
    const trimmed = source.replace(/\s+$/, '');
    return `${trimmed}\n\n${generated}\n`;
  }
  let end = lines.length;
  let inFence = false;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^```/.test(lines[index])) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return [...lines.slice(0, headingIndex), generated, ...lines.slice(end)].join('\n');
}

/**
 * Keep the sections whose heading or body contains every word of the
 * query (case-insensitive). An empty query keeps every section.
 */
export function filterGuideSections(sections: readonly GuideSection[], query: string): GuideSection[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return [...sections];
  return sections.filter((section) => terms.every((term) => section.text.includes(term)));
}
