import { decodeHtmlEntities } from './html-entities';

const ALLOWED_TAGS = new Set([
  'a',
  'article',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);
const VOID_TAGS = new Set([
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const BLOCKED_TAGS = new Set([
  'button',
  'embed',
  'fieldset',
  'form',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'noscript',
  'object',
  'option',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
  'head',
  'title',
]);
const TASK_ATTRIBUTES = new Set([
  'data-a11y-task-id',
  'data-a11y-task-complete',
  'data-a11y-task-due',
  'data-a11y-task-priority',
  'data-a11y-task-remind',
]);

function escapeText(value: string) {
  return value
    .replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string) {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function validUrl(
  tag: string,
  name: string,
  rawValue: string,
  options: { allowVaultImages?: boolean; baseUrl?: string; imageReferences?: Map<string, string> },
) {
  const value = decodeHtmlEntities(rawValue).trim();
  if (name === 'href') {
    if (value.startsWith('#')) return value;
    try {
      const target = new URL(value, options.baseUrl);
      return ['http:', 'https:', 'mailto:'].includes(target.protocol) && !target.username && !target.password
        ? target.href
        : '';
    } catch {
      return '';
    }
  }
  if (name !== 'src' || tag !== 'img') return '';
  if (/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z\d+/]+=*$/i.test(value)) return value;
  let local = value;
  if (options.baseUrl && options.imageReferences) {
    try {
      local = options.imageReferences.get(new URL(value, options.baseUrl).href) ?? '';
    } catch {
      return '';
    }
  }
  if (options.allowVaultImages && /^vault-file:\/\/attachment\//i.test(local)) return local;
  if (!options.allowVaultImages || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(local)) return '';
  if (!/\.(?:png|jpe?g|gif|webp|bmp)(?:[?#].*)?$/i.test(local)) return '';
  if (
    local
      .split(/[?#]/, 1)[0]
      .split('/')
      .some((part) => part === '..' || part === '.' || !part)
  )
    return '';
  return local;
}

function readTag(source: string, start: number) {
  let end = start + 1;
  let quote = '';
  while (end < source.length) {
    const character = source[end];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return end + 1;
    end += 1;
  }
  return -1;
}

function attributes(raw: string) {
  const result: Array<[string, string]> = [];
  const opening = /^<\s*\/?\s*[a-z][\w:-]*/i.exec(raw)?.[0].length ?? 0;
  const content = raw.slice(opening, -1);
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of content.matchAll(pattern)) {
    result.push([match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '']);
  }
  return result;
}

/** Conservative main-process sanitizer for exported and captured standalone HTML. */
export function sanitizeHtmlFragment(
  source: string,
  options: {
    allowVaultImages?: boolean;
    baseUrl?: string;
    imageReferences?: Map<string, string>;
    renderTaskControls?: boolean;
  } = {},
) {
  let output = '';
  let cursor = 0;
  const blocked: string[] = [];
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) {
      if (!blocked.length) output += escapeText(source.slice(cursor));
      break;
    }
    if (!blocked.length) output += escapeText(source.slice(cursor, start));
    if (source.startsWith('<!--', start)) {
      const close = source.indexOf('-->', start + 4);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    const end = readTag(source, start);
    if (end < 0) {
      if (!blocked.length) output += '&lt;';
      cursor = start + 1;
      continue;
    }
    const raw = source.slice(start, end);
    const match = /^<\s*(\/?)\s*([a-z][\w:-]*)/i.exec(raw);
    cursor = end;
    if (!match) continue;
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (blocked.length) {
      if (closing && blocked[blocked.length - 1] === tag) blocked.pop();
      else if (!closing && BLOCKED_TAGS.has(tag) && !VOID_TAGS.has(tag)) blocked.push(tag);
      continue;
    }
    if (BLOCKED_TAGS.has(tag)) {
      if (!closing && !VOID_TAGS.has(tag)) blocked.push(tag);
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) output += `</${tag}>`;
      continue;
    }
    const safeAttributes = new Map<string, string>();
    for (const [name, value] of attributes(raw)) {
      if (['title', 'alt', 'scope', 'lang', 'dir'].includes(name)) safeAttributes.set(name, value);
      else if (name === 'href' || name === 'src') {
        const safe = validUrl(tag, name, value, options);
        if (safe) safeAttributes.set(name, safe);
      } else if (TASK_ATTRIBUTES.has(name)) {
        if (
          name === 'data-a11y-task-remind'
            ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
            : /^[\w -]{1,128}$/.test(value)
        )
          safeAttributes.set(name, value);
      } else if (['colspan', 'rowspan'].includes(name) && /^\d{1,2}$/.test(value)) {
        safeAttributes.set(name, value);
      }
    }
    if (tag === 'img' && (!safeAttributes.has('src') || !safeAttributes.get('alt')?.trim())) {
      output += escapeText(safeAttributes.get('alt') ?? '');
      continue;
    }
    output += `<${tag}${[...safeAttributes].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('')}>`;
    if (
      options.renderTaskControls &&
      tag === 'li' &&
      /^[\w-]{8,80}$/.test(safeAttributes.get('data-a11y-task-id') ?? '') &&
      ['true', 'false'].includes(safeAttributes.get('data-a11y-task-complete') ?? '')
    ) {
      output += `<input type="checkbox" disabled aria-label="Checklist item" ${
        safeAttributes.get('data-a11y-task-complete') === 'true' ? 'checked ' : ''
      }>`;
    }
  }
  return output;
}

export function standaloneHtml(title: string, fragment: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escapeText(title)}</title></head><body>${fragment}</body></html>\n`;
}
