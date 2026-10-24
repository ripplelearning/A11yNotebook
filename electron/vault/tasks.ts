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
    const stableId = /<!--\s*a11y-task-id:([\w-]{8,80})\s*-->$/.exec(checkbox[2])?.[1];
    const text = checkbox[2].replace(/\s*<!--\s*a11y-task-id:[\w-]{8,80}\s*-->$/, '').trim();
    const dueDate = text.match(/(?:📅\s*|due:)(\d{4}-\d{2}-\d{2})/i)?.[1];
    const dueTime = text.match(/due-time:(\d{2}:\d{2})/i)?.[1];
    const priority = text.match(/priority:([A-Za-z0-9][A-Za-z0-9_-]{0,29})/i)?.[1];
    const title = text
      .replace(/(?:📅\s*|due:)\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/due-time:\d{2}:\d{2}/gi, '')
      .replace(/priority:[A-Za-z0-9][A-Za-z0-9_-]{0,29}/gi, '')
      .trim();
    return [
      {
        id: stableId ? `${relativePath}#${stableId}` : `${relativePath}:${index + 1}`,
        path: relativePath,
        line: index + 1,
        ...(stableId ? { taskId: stableId } : {}),
        text: title,
        complete: checkbox[1].toLowerCase() === 'x',
        ...(dueDate ? { dueDate } : {}),
        ...(dueTime ? { dueTime } : {}),
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
    const dueTime = token.attributes.get('data-a11y-task-due-time')?.value ?? '';
    const priority = token.attributes.get('data-a11y-task-priority')?.value ?? '';
    const reminder = token.attributes.get('data-a11y-task-remind')?.value ?? '';
    return [
      {
        id,
        token,
        text: taskText(content.slice(token.end, close)),
        complete: complete === 'true',
        ...(validDate(due) ? { dueDate: due } : {}),
        ...(/^\d{2}:\d{2}$/.test(dueTime) ? { dueTime } : {}),
        ...(/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(priority) ? { priority } : {}),
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
            ...(item.dueTime ? { dueTime: item.dueTime } : {}),
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

/** Set or remove one data attribute on a single stable HTML task, leaving all other source bytes intact. */
function withTaskAttribute(content: string, taskId: string, name: string, value: string): string {
  const matches = htmlTaskRecords(content).filter((item) => item.id === taskId);
  if (matches.length !== 1) throw new Error('The HTML task no longer exists or its identity is ambiguous.');
  const token = matches[0].token;
  const attribute = token.attributes.get(name);
  const tag = content.slice(token.start, token.end);
  if (!value) {
    if (!attribute) return content;
    const removed = tag.replace(
      new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i'),
      '',
    );
    return `${content.slice(0, token.start)}${removed}${content.slice(token.end)}`;
  }
  if (attribute) {
    return `${content.slice(0, attribute.valueStart)}${value}${content.slice(attribute.valueEnd)}`;
  }
  const updated = tag.replace(/\/?>$/, (ending) => ` ${name}="${value}"${ending}`);
  return `${content.slice(0, token.start)}${updated}${content.slice(token.end)}`;
}

export interface TaskSchedule {
  dueDate: string;
  dueTime: string;
  /** Reminder in "YYYY-MM-DD HH:mm" form, or '' for none. */
  remindAt: string;
}

function validTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** Update the due date, due time, and reminder of one stable HTML task. */
export function updateHtmlTaskSchedule(content: string, taskId: string, schedule: TaskSchedule): string {
  if (schedule.dueDate && !validDate(schedule.dueDate)) throw new Error('Enter a real date in YYYY-MM-DD format.');
  if (schedule.dueTime && !validTime(schedule.dueTime)) throw new Error('Enter a time in HH:mm format.');
  if (schedule.remindAt && !parseReminderDate(schedule.remindAt)) {
    throw new Error('Enter a real reminder date and time.');
  }
  let updated = withTaskAttribute(content, taskId, 'data-a11y-task-due', schedule.dueDate);
  updated = withTaskAttribute(updated, taskId, 'data-a11y-task-due-time', schedule.dueTime);
  return withTaskAttribute(updated, taskId, 'data-a11y-task-remind', schedule.remindAt);
}

/** Update the priority of one stable HTML task. */
export function updateHtmlTaskPriority(content: string, taskId: string, priority: string): string {
  if (priority && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(priority)) {
    throw new Error('Priority names use one word of letters, digits, hyphens, or underscores.');
  }
  return withTaskAttribute(content, taskId, 'data-a11y-task-priority', priority);
}
