// Parses task metadata from Markdown and semantic HTML without changing note formats.
import type { VaultTask } from '../../src/shared/types';
import { createHash } from 'node:crypto';
import { decodeHtmlEntities } from './html-entities';
import { parseReminderDate } from '../../src/shared/reminders';

/** Return Markdown checkbox tasks with their source line and optional due date/priority. */
export function parseMarkdownTasks(content: string, relativePath: string): VaultTask[] {
  return content.split(/\r?\n/).flatMap((lineText, index) => {
    const checkbox = lineText.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (!checkbox) return [];
    const text = checkbox[2].trim();
    const dueDate = text.match(/(?:📅\s*|due:)(\d{4}-\d{2}-\d{2})/i)?.[1];
    const priority = text.match(/priority:(low|normal|high|urgent)\b/i)?.[1]?.toLowerCase() as VaultTask['priority'];
    const title = text
      .replace(/(?:📅\s*|due:)\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/priority:(?:low|normal|high|urgent)\b/gi, '')
      .trim();
    return [
      {
        id: `${relativePath}:${index + 1}`,
        path: relativePath,
        line: index + 1,
        text: title,
        complete: checkbox[1].toLowerCase() === 'x',
        ...(dueDate ? { dueDate } : {}),
        ...(priority ? { priority } : {}),
      },
    ];
  });
}

interface HtmlToken {
  name: string;
  start: number;
  end: number;
  closing: boolean;
  attributes: Map<string, { value: string; valueStart: number; valueEnd: number }>;
}

function htmlTokens(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  for (let index = 0; index < source.length;) {
    const start = source.indexOf('<', index);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    let end = start + 1;
    let quote = '';
    while (end < source.length) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
      end += 1;
    }
    if (end >= source.length) break;
    const raw = source.slice(start, end + 1);
    const tag = /^<\s*(\/?)\s*([a-z][\w:-]*)/i.exec(raw);
    index = end + 1;
    if (!tag) continue;
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      tokens.push({ name, start, end: end + 1, closing: true, attributes: new Map() });
      continue;
    }
    const attributes = new Map<string, { value: string; valueStart: number; valueEnd: number }>();
    const startAttributes = tag[0].length;
    const remainder = raw.slice(startAttributes, -1);
    const attributePattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const match of remainder.matchAll(attributePattern)) {
      const key = match[1].toLowerCase();
      if (attributes.has(key)) continue;
      const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
      const equals = match[0].indexOf('=');
      const quotedOffset =
        equals < 0
          ? match[0].length
          : match[2] !== undefined
            ? match[0].indexOf('"', equals + 1) + 1
            : match[3] !== undefined
              ? match[0].indexOf("'", equals + 1) + 1
              : match[0].indexOf(rawValue, equals + 1);
      const valueStart = start + startAttributes + (match.index ?? 0) + Math.max(0, quotedOffset);
      attributes.set(key, { value: decodeHtmlEntities(rawValue), valueStart, valueEnd: valueStart + rawValue.length });
    }
    tokens.push({ name, start, end: end + 1, closing: false, attributes });
    if (
      [
        'form',
        'iframe',
        'math',
        'noscript',
        'object',
        'script',
        'style',
        'svg',
        'template',
        'textarea',
        'title',
      ].includes(name)
    ) {
      const close = new RegExp(`<\\/\\s*${name}\\s*>`, 'ig');
      close.lastIndex = index;
      const closingTag = close.exec(source);
      if (closingTag) index = closingTag.index;
      else break;
    }
  }
  return tokens;
}

function taskText(source: string) {
  return decodeHtmlEntities(source.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function htmlTaskRecords(content: string) {
  const tokens = htmlTokens(content);
  return tokens.flatMap((token, index) => {
    if (token.name !== 'li' || token.closing) return [];
    const id = token.attributes.get('data-a11y-task-id')?.value ?? '';
    const complete = token.attributes.get('data-a11y-task-complete')?.value;
    if (!/^[\w-]{8,80}$/.test(id) || !['true', 'false'].includes(complete ?? '')) return [];
    let depth = 1;
    let close = token.end;
    for (const candidate of tokens.slice(index + 1)) {
      if (candidate.name !== 'li') continue;
      if (candidate.closing) depth -= 1;
      else depth += 1;
      if (!depth) {
        close = candidate.start;
        break;
      }
    }
    const due = token.attributes.get('data-a11y-task-due')?.value ?? '';
    const priority = token.attributes.get('data-a11y-task-priority')?.value?.toLowerCase();
    const reminder = token.attributes.get('data-a11y-task-remind')?.value ?? '';
    return [
      {
        id,
        token,
        text: taskText(content.slice(token.end, close)),
        complete: complete === 'true',
        ...(validDate(due) ? { dueDate: due } : {}),
        ...(priority && ['low', 'normal', 'high', 'urgent'].includes(priority)
          ? { priority: priority as VaultTask['priority'] }
          : {}),
        ...(parseReminderDate(reminder) ? { reminder } : {}),
      },
    ];
  });
}

/** Parse stable, explicitly marked HTML checklist items. Duplicate IDs are ignored. */
export function parseHtmlTasks(content: string, relativePath: string, revision?: string): VaultTask[] {
  const records = htmlTaskRecords(content);
  const counts = new Map<string, number>();
  for (const item of records) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const hash = revision ?? createHash('sha256').update(content, 'utf8').digest('hex');
  return records.flatMap((item) =>
    counts.get(item.id) === 1 && item.text
      ? [
          {
            id: `${relativePath}#${item.id}`,
            taskId: item.id,
            htmlTask: true,
            revision: hash,
            path: relativePath,
            text: item.text,
            complete: item.complete,
            ...(item.reminder ? { remindAt: item.reminder } : {}),
            ...(item.dueDate ? { dueDate: item.dueDate } : {}),
            ...(item.priority ? { priority: item.priority } : {}),
          },
        ]
      : [],
  );
}

/** Change only the completion attribute on the identified checklist item. */
export function toggleHtmlTask(content: string, taskId: string, complete: boolean) {
  const matches = htmlTaskRecords(content).filter((item) => item.id === taskId);
  if (matches.length !== 1) throw new Error('The HTML task no longer exists or its identity is ambiguous.');
  const token = matches[0].token;
  const state = token.attributes.get('data-a11y-task-complete');
  if (!state) throw new Error('The HTML task no longer has a valid completion state.');
  return `${content.slice(0, state.valueStart)}${complete ? 'true' : 'false'}${content.slice(state.valueEnd)}`;
}

/** Update the due-date field on one stable HTML task, leaving all other source bytes intact. */
export function updateHtmlTaskDueDate(content: string, taskId: string, dueDate: string) {
  if (dueDate && !validDate(dueDate)) throw new Error('Enter a real date in YYYY-MM-DD format.');
  const matches = htmlTaskRecords(content).filter((item) => item.id === taskId);
  if (matches.length !== 1) throw new Error('The HTML task no longer exists or its identity is ambiguous.');
  const token = matches[0].token;
  const attribute = token.attributes.get('data-a11y-task-due');
  if (attribute) {
    if (!dueDate) {
      const tag = content.slice(token.start, token.end);
      const removed = tag.replace(/\s+data-a11y-task-due\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
      return `${content.slice(0, token.start)}${removed}${content.slice(token.end)}`;
    }
    return `${content.slice(0, attribute.valueStart)}${dueDate}${content.slice(attribute.valueEnd)}`;
  }
  if (!dueDate) return content;
  const tag = content.slice(token.start, token.end);
  const updated = tag.replace(/\/?>$/, (ending) => ` data-a11y-task-due="${dueDate}"${ending}`);
  return `${content.slice(0, token.start)}${updated}${content.slice(token.end)}`;
}
