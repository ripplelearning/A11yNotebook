// Bounded YAML front-matter editing for notes. The supported subset is
// what notes actually use: top-level keys with scalar values (plain,
// single- or double-quoted) and string lists, written either as a flow
// list (`tags: [a, b]`), a comma list (`tags: a, b`), or a block list
// (`tags:` followed by `- item` lines). Anything richer (nested maps,
// anchors, multi-line strings, explicit tags) is reported as unsupported
// so callers can refuse structured editing instead of mangling the file.
// The note body is never touched: edits rewrite only the --- block.

export interface FrontMatterEntry {
  key: string;
  kind: 'scalar' | 'list';
  /** Scalar text when kind is 'scalar'. */
  value: string;
  /** Items when kind is 'list'. */
  items: string[];
}

export interface FrontMatterDocument {
  /** False when the block uses constructs outside the supported subset. */
  supported: boolean;
  /** Why editing is unsupported, when it is not. */
  unsupportedReason?: string;
  entries: FrontMatterEntry[];
  /** The note content after the front-matter block (the whole content when there is none). */
  body: string;
  /** True when the content started with a front-matter block. */
  hadFrontMatter: boolean;
}

const BLOCK_START = /^---\r?\n/;
const BLOCK_END = /\r?\n---(?:\r?\n|$)/;
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*))?$/;
const BLOCK_ITEM = /^[ \t]+-[ \t]+(.*)$/;

function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function splitFlowList(text: string): string[] {
  return text
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

function parseScalarOrList(raw: string): { kind: 'scalar' | 'list'; value: string; items: string[] } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { kind: 'list', value: '', items: splitFlowList(trimmed.slice(1, -1)) };
  }
  return { kind: 'scalar', value: unquote(trimmed), items: [] };
}

/** Parse a note's front matter. Editing operations require `supported`. */
export function parseFrontMatter(content: string): FrontMatterDocument {
  const start = BLOCK_START.exec(content);
  if (!start) return { supported: true, entries: [], body: content, hadFrontMatter: false };
  const rest = content.slice(start[0].length);
  const end = BLOCK_END.exec(rest);
  if (!end || end.index === undefined)
    return {
      supported: false,
      unsupportedReason: 'The front-matter block is not closed with a --- line.',
      entries: [],
      body: content,
      hadFrontMatter: true,
    };
  const block = rest.slice(0, end.index);
  const body = rest.slice(end.index + end[0].length);
  const entries: FrontMatterEntry[] = [];
  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^[ \t]/.test(line)) {
      return {
        supported: false,
        unsupportedReason: `Indented content at front-matter line ${index + 1} (nested values are not supported).`,
        entries: [],
        body,
        hadFrontMatter: true,
      };
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      return {
        supported: false,
        unsupportedReason: `Front-matter line ${index + 1} is not a simple key: value pair.`,
        entries: [],
        body,
        hadFrontMatter: true,
      };
    }
    const key = match[1];
    const rawValue = (match[2] ?? '').trim();
    if (/[|>&*!{]/.test(rawValue[0] ?? '') || rawValue.endsWith(':')) {
      return {
        supported: false,
        unsupportedReason: `The value for "${key}" uses a YAML construct that is not supported here.`,
        entries: [],
        body,
        hadFrontMatter: true,
      };
    }
    if (rawValue === '') {
      // Either an empty scalar or the header of a block list.
      const items: string[] = [];
      let next = index + 1;
      while (next < lines.length) {
        const item = BLOCK_ITEM.exec(lines[next]);
        if (!item) break;
        items.push(unquote(item[1]));
        next += 1;
      }
      if (items.length) {
        entries.push({ key, kind: 'list', value: '', items });
        index = next - 1;
        continue;
      }
      entries.push({ key, kind: 'scalar', value: '', items: [] });
      continue;
    }
    const parsed = parseScalarOrList(rawValue);
    // A comma-separated scalar under a plural-ish key stays a scalar
    // unless it was bracketed; only `tags` is conventionally comma-split,
    // and the editor exposes it as a list explicitly via asListEntry.
    entries.push({ key, ...parsed });
  }
  return { supported: true, entries, body, hadFrontMatter: true };
}

function needsQuoting(value: string): boolean {
  return (
    value === '' ||
    /^\s|\s$/.test(value) ||
    /[:#[\]{},&*!|>'"%@`]/.test(value) ||
    /^(?:true|false|null|~|[-+]?\d[\d.]*)$/i.test(value)
  );
}

function quote(value: string): string {
  return needsQuoting(value) ? JSON.stringify(value) : value;
}

/** Serialize entries back into a full note: --- block + the given body. */
export function serializeFrontMatter(entries: FrontMatterEntry[], body: string): string {
  if (!entries.length) return body;
  const lines: string[] = ['---'];
  for (const entry of entries) {
    if (entry.kind === 'list') {
      if (!entry.items.length) {
        lines.push(`${entry.key}: []`);
      } else if (entry.items.length === 1) {
        lines.push(`${entry.key}: [${quote(entry.items[0])}]`);
      } else {
        lines.push(`${entry.key}:`);
        for (const item of entry.items) lines.push(`  - ${quote(item)}`);
      }
    } else {
      lines.push(`${entry.key}: ${quote(entry.value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

/** Set a scalar value, preserving entry order; appends new keys at the end. */
export function setScalar(entries: FrontMatterEntry[], key: string, value: string): FrontMatterEntry[] {
  const next = entries.filter((entry) => entry.key !== key);
  const index = entries.findIndex((entry) => entry.key === key);
  const entry: FrontMatterEntry = { key, kind: 'scalar', value, items: [] };
  if (index === -1) return [...next, entry];
  next.splice(index, 0, entry);
  return next;
}

/** Set a list value, preserving entry order; appends new keys at the end. */
export function setList(entries: FrontMatterEntry[], key: string, items: string[]): FrontMatterEntry[] {
  const cleaned = items.map((item) => item.trim()).filter((item) => item.length > 0);
  const next = entries.filter((entry) => entry.key !== key);
  const index = entries.findIndex((entry) => entry.key === key);
  const entry: FrontMatterEntry = { key, kind: 'list', value: '', items: cleaned };
  if (index === -1) return [...next, entry];
  next.splice(index, 0, entry);
  return next;
}

export function removeEntry(entries: FrontMatterEntry[], key: string): FrontMatterEntry[] {
  return entries.filter((entry) => entry.key !== key);
}

/** The tags of a parsed document: the `tags` entry as a list, however it was written. */
export function tagsOf(document: FrontMatterDocument): string[] {
  const entry = document.entries.find((item) => item.key.toLowerCase() === 'tags');
  if (!entry) return [];
  if (entry.kind === 'list') return entry.items;
  return splitFlowList(entry.value);
}

/** Tag suggestions: library tags not already on the note, in library order. */
export function suggestTags(libraryTags: string[], current: string[]): string[] {
  const present = new Set(current.map((tag) => tag.toLowerCase()));
  return libraryTags.filter((tag) => !present.has(tag.toLowerCase()));
}
