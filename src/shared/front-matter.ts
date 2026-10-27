// Bounded YAML front-matter editing for notes. The supported subset is
// what notes actually use: top-level keys with scalar values (plain,
// single- or double-quoted) and string lists, written either as a flow
// list (`tags: [a, b]`), a comma list (`tags: a, b`), or a block list
// (`tags:` followed by `- item` lines). Anything richer (nested maps,
// anchors, multi-line strings, explicit tags) is reported as unsupported
// so callers can refuse structured editing instead of mangling the file.
// The note body is never touched: edits rewrite only the --- block.
//
// Scalars keep their YAML type: a parsed scalar remembers its exact
// source text (`raw`) and its inferred type (`scalarType`), so opening
// the editor and applying without touching a field never rewrites
// `count: 5` as `count: "5"` or `draft: true` as `draft: "true"`. A
// changed value keeps its type only when the new text parses as that
// same type; otherwise it is written as a quoted string, which is the
// safe default for free text. List items are always treated as text.

export type ScalarType = 'string' | 'number' | 'boolean' | 'null';

export interface FrontMatterEntry {
  key: string;
  kind: 'scalar' | 'list';
  /** Scalar text when kind is 'scalar'. */
  value: string;
  /** Items when kind is 'list'. */
  items: string[];
  /** Exact source text of a parsed scalar (after the colon), when known. */
  raw?: string;
  /** YAML type inferred from `raw` for a parsed scalar, when known. */
  scalarType?: ScalarType;
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

function parseScalarOrList(raw: string): {
  kind: 'scalar' | 'list';
  value: string;
  items: string[];
  raw?: string;
  scalarType?: ScalarType;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { kind: 'list', value: '', items: splitFlowList(trimmed.slice(1, -1)) };
  }
  return { kind: 'scalar', value: unquote(trimmed), items: [], raw: trimmed, scalarType: inferScalarType(trimmed) };
}

/** Infer a scalar's YAML type from its source text. Quoted text is always a string. */
export function inferScalarType(raw: string): ScalarType {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return 'string';
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return 'string';
  if (/^(true|false)$/i.test(trimmed)) return 'boolean';
  if (/^(null|~)$/i.test(trimmed)) return 'null';
  if (/^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) return 'number';
  return 'string';
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
      // A bare `key:` line is a null in YAML, preserved verbatim.
      entries.push({ key, kind: 'scalar', value: '', items: [], raw: '', scalarType: 'null' });
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

/** Serialize one scalar entry, preserving its YAML type when possible. */
function serializeScalar(entry: FrontMatterEntry): string {
  if (entry.raw !== undefined && entry.value === unquote(entry.raw)) {
    return entry.raw === '' ? `${entry.key}:` : `${entry.key}: ${entry.raw}`;
  }
  if (
    (entry.scalarType === 'number' || entry.scalarType === 'boolean' || entry.scalarType === 'null') &&
    inferScalarType(entry.value) === entry.scalarType
  ) {
    return `${entry.key}: ${entry.value}`;
  }
  return `${entry.key}: ${quote(entry.value)}`;
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
      lines.push(serializeScalar(entry));
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

/** Set a scalar value, preserving entry order; appends new keys at the end. */
export function setScalar(entries: FrontMatterEntry[], key: string, value: string): FrontMatterEntry[] {
  const next = entries.filter((entry) => entry.key !== key);
  const index = entries.findIndex((entry) => entry.key === key);
  // A freshly set value carries the raw form it will serialize to, so a
  // parse of the serialized note yields the same entry.
  const raw = quote(value);
  const entry: FrontMatterEntry = {
    key,
    kind: 'scalar',
    value,
    items: [],
    raw,
    scalarType: inferScalarType(raw),
  };
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

/** Field-name suggestions: library field names not already on the note, sorted. */
export function suggestKeys(
  libraryFields: Record<string, string[]>,
  currentKeys: string[],
): string[] {
  const present = new Set(currentKeys.map((key) => key.toLowerCase()));
  return Object.keys(libraryFields)
    .filter((key) => !present.has(key.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

/** Value suggestions: values the library uses for this field, excluding ones already on it. */
export function suggestValues(
  libraryFields: Record<string, string[]>,
  key: string,
  currentValues: string[],
): string[] {
  const present = new Set(currentValues.map((value) => value.toLowerCase()));
  const seen = new Set<string>();
  const values: string[] = [];
  for (const [field, items] of Object.entries(libraryFields)) {
    if (field.toLowerCase() !== key.toLowerCase()) continue;
    for (const item of items) {
      const lowered = item.toLowerCase();
      if (present.has(lowered) || seen.has(lowered)) continue;
      seen.add(lowered);
      values.push(item);
    }
  }
  return values;
}
