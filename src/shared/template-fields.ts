// Fillable {{Name}} fields in templates.
//
// The six placeholders expandTemplate() already knows (title, notebook,
// date, time, weekday, cursor) fill themselves in when a note is created
// from a template. Any other {{Name}} in a template note renders as a
// fillable textbox in the reading view, with that name as its accessible
// name. Saving bakes the typed values into the note text (see
// fillTemplateFields); a filled note remembers its source template in
// the template-links sidecar (electron/vault/template-links.ts).
//
// Parsing and filling share one scanner, so a marker that never renders
// as a field (inside a fenced code block, inline code, or — for HTML
// notes — inside a tag) is never baked either. A typo'd known
// placeholder such as {{dat}} becomes a textbox instead of staying
// visible as literal text; that trade-off is stated in the templates
// scope doc and is visible to the template author.

/** Placeholders expandTemplate() fills in; everything else is a field. */
export const KNOWN_TEMPLATE_PLACEHOLDERS = ['title', 'notebook', 'date', 'time', 'weekday', 'cursor'] as const;

export type TemplateNoteFormat = 'markdown' | 'html';

export interface TemplateField {
  /** Name inside the braces, as written (trimmed). */
  name: string;
  /** Accessible name: the name alone, or "Name 1", "Name 2" when repeated. */
  label: string;
  /** Zero-based occurrence among all fields, in document order. */
  index: number;
}

/** One filled note's link back to the template it was made from. */
export interface TemplateLinkRecord {
  /** Library-relative path of the filled note. */
  path: string;
  /** Library-relative path of the source template note. */
  templatePath: string;
  updatedAt: string;
  schemaVersion: 1;
}

export const TEMPLATE_LINK_SCHEMA_VERSION = 1 as const;

export const TEMPLATE_LINK_LIMITS = {
  records: 10000,
} as const;

const KNOWN = new Set<string>(KNOWN_TEMPLATE_PLACEHOLDERS);

/**
 * One pass over the content, visiting fenced blocks, inline code, HTML
 * tags (HTML notes only), and {{...}} markers. The callback receives
 * each marker's raw text and trimmed name and returns the replacement
 * (null keeps the marker as written). Non-marker segments are never
 * touched, so values are never re-scanned.
 */
function scanTemplatePlaceholders(
  content: string,
  format: TemplateNoteFormat,
  onPlaceholder: (raw: string, name: string) => string | null,
): string {
  const pattern =
    format === 'html'
      ? /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)|`+[^`\n]*`+|<[^>\n]*>|\{\{([^{}]*)\}\}/g
      : /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)|`+[^`\n]*`+|\{\{([^{}]*)\}\}/g;
  let result = '';
  let previous = 0;
  for (const match of content.matchAll(pattern)) {
    const nameGroup = match[match.length - 1];
    if (nameGroup === undefined) continue;
    result += content.slice(previous, match.index);
    result += onPlaceholder(match[0], nameGroup.trim()) ?? match[0];
    previous = match.index + match[0].length;
  }
  return result + content.slice(previous);
}

function isFieldName(name: string): boolean {
  return name.length > 0 && !KNOWN.has(name);
}

/** All fillable fields in a note, in document order, with numbered labels for repeats. */
export function parseTemplateFields(content: string, format: TemplateNoteFormat): TemplateField[] {
  const names: string[] = [];
  scanTemplatePlaceholders(content, format, (_raw, name) => {
    if (isFieldName(name)) names.push(name);
    return null;
  });
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name, index) => {
    const occurrence = (seen.get(name) ?? 0) + 1;
    seen.set(name, occurrence);
    return {
      name,
      label: (counts.get(name) ?? 0) > 1 ? `${name} ${occurrence}` : name,
      index,
    };
  });
}

/**
 * Replace each field marker with its value, in document order. A null
 * or missing value leaves that marker in place, so saving a partly
 * filled note keeps the unfilled fields fillable. Known placeholders
 * and markers inside code or HTML tags are never replaced.
 */
export function fillTemplateFields(
  content: string,
  values: readonly (string | null | undefined)[],
  format: TemplateNoteFormat,
): string {
  let fieldIndex = 0;
  return scanTemplatePlaceholders(content, format, (_raw, name) => {
    if (!isFieldName(name)) return null;
    const value = values[fieldIndex];
    fieldIndex += 1;
    return value ?? null;
  });
}

/** A note stored under the library's Templates folder. */
export function isTemplateNotePath(path: string): boolean {
  return path.startsWith('Templates/');
}

/** True when at least one typed value has non-blank text. */
export function hasFilledTemplateValues(values: readonly (string | null | undefined)[]): boolean {
  return values.some((value) => value !== null && value !== undefined && value.trim() !== '');
}
