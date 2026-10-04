export interface NoteTemplate {
  id: string;
  name: string;
  content: string;
  format?: 'markdown' | 'html';
}

export interface TemplateContext {
  title: string;
  notebook: string;
  now?: Date;
}

export interface ExpandedTemplate {
  content: string;
  cursor: number;
}

export const BUILT_IN_TEMPLATES: NoteTemplate[] = [
  {
    id: 'daily',
    name: 'Daily',
    content: '# {{title}}\n\n{{date}} · {{weekday}}\n\n## Priorities\n\n- [ ] {{cursor}}\n\n## Notes\n\n',
  },
  {
    id: 'meeting',
    name: 'Meeting',
    content:
      '# {{title}}\n\nDate: {{date}}\nTime: {{time}}\n\n## Attendees\n\n{{cursor}}\n\n## Agenda\n\n- \n\n## Decisions\n\n\n## Action items\n\n- [ ] \n',
  },
  {
    id: 'project',
    name: 'Project',
    content:
      '# {{title}}\n\nNotebook: {{notebook}}\nCreated: {{date}}\n\n## Goal\n\n{{cursor}}\n\n## Milestones\n\n- [ ] \n\n## Resources\n\n',
  },
  {
    id: 'reading',
    name: 'Reading',
    content:
      '# {{title}}\n\nDate: {{date}}\n\n## Source\n\n{{cursor}}\n\n## Summary\n\n\n## Key ideas\n\n- \n\n## Questions\n\n',
  },
  {
    id: 'lecture',
    name: 'Lecture',
    content: '# {{title}}\n\nDate: {{date}}\n\n## Topic\n\n{{cursor}}\n\n## Notes\n\n\n## Review questions\n\n- \n',
  },
];

/** Expand known placeholders in a single pass; unknown placeholders remain literal. */
export function expandTemplate(template: string, context: TemplateContext): ExpandedTemplate {
  const now = context.now ?? new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const values: Record<string, string> = {
    title: context.title,
    notebook: context.notebook,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
  };
  let content = '';
  let cursor: number | undefined;
  let previous = 0;
  for (const match of template.matchAll(/\{\{(title|notebook|date|time|weekday|cursor)\}\}/g)) {
    content += template.slice(previous, match.index);
    if (match[1] === 'cursor') cursor ??= content.length;
    else content += values[match[1]];
    previous = match.index + match[0].length;
  }
  content += template.slice(previous);
  return { content, cursor: cursor ?? content.length };
}

export function validateNoteTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'Enter a note title.';
  if (
    /[/\\<>:"|?*]/.test(trimmed) ||
    Array.from(trimmed).some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(title) ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    return 'Use a file name without path separators, reserved characters, or a trailing dot or space.';
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) {
    return 'This file name is reserved. Choose another title.';
  }
  if (trimmed.length > 200) return 'Use a title of 200 characters or fewer.';
  return null;
}

export function templateNotePath(
  notebookPath: string,
  title: string,
  format: 'markdown' | 'html' = 'markdown',
): string {
  const error = validateNoteTitle(title);
  if (error) throw new Error(error);
  const trimmedTitle = title.trim();
  const existingExtension = trimmedTitle.match(/\.(md|html)$/i)?.[0];
  const base = existingExtension ? trimmedTitle.slice(0, -existingExtension.length) : trimmedTitle;
  const extension = format === 'html' ? '.html' : '.md';
  const filename = `${base}${existingExtension?.toLowerCase() === extension ? existingExtension : extension}`;
  return notebookPath ? `${notebookPath.replace(/\/$/, '')}/${filename}` : filename;
}
