/**
 * A small focused HTML-to-Markdown converter for pasted structured
 * content (Q12): headings, lists, and tables become Markdown, and
 * anything with no Markdown equivalent is dropped. It runs on HTML that
 * was already sanitized, so it only reads text and attributes and never
 * executes anything. No new dependency: the app has no HTML-to-Markdown
 * library, and pasted content only needs these structures.
 */

const DROPPED_TAGS = new Set([
  'script',
  'style',
  'svg',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'option',
  'fieldset',
  'noscript',
  'canvas',
  'link',
  'meta',
  'title',
  'head',
]);

/** Container elements whose children convert as blocks, with no marker of their own. */
const TRANSPARENT_BLOCK_TAGS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'figure',
  'body',
  'html',
]);

function tagName(node: Node): string {
  return node.nodeType === node.ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : '';
}

function collapseWhitespace(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ');
}

/** Inline text of a node: links, emphasis, code, and line breaks become Markdown; the rest is plain text. */
function inlineText(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return collapseWhitespace(node.textContent ?? '');
  if (node.nodeType !== node.ELEMENT_NODE) return '';
  const element = node as Element;
  const tag = tagName(node);
  if (DROPPED_TAGS.has(tag)) return '';
  if (tag === 'br') return '\n';
  if (tag === 'img') return imageMarkdown(element);
  if (tag === 'a') {
    const text = childrenInline(element).trim();
    const href = (element.getAttribute('href') ?? '').trim();
    if (!text) return '';
    if (/^(?:https?:|mailto:)/i.test(href)) return `[${text}](${href})`;
    return text;
  }
  if (tag === 'strong' || tag === 'b') {
    const text = childrenInline(element).trim();
    return text ? `**${text}**` : '';
  }
  if (tag === 'em' || tag === 'i') {
    const text = childrenInline(element).trim();
    return text ? `*${text}*` : '';
  }
  if (tag === 'code') {
    const text = (element.textContent ?? '').replace(/`/g, "'");
    return text ? `\`${text}\`` : '';
  }
  if (tag === 'ul' || tag === 'ol' || tag === 'table' || tag === 'pre' || tag === 'blockquote') {
    // A block inside an inline position (for example a list inside a list
    // item) is rendered on its own lines by the block converter; inline
    // text here keeps only its text so nothing is lost.
    return childrenInline(element);
  }
  return childrenInline(element);
}

function childrenInline(node: Node): string {
  let result = '';
  node.childNodes.forEach((child) => {
    result += inlineText(child);
  });
  return result;
}

/**
 * Images: a web address becomes `![alt](url)`; anything else is dropped.
 * A data-URL image would inline megabytes of base64 into the note, so it
 * is dropped here — it is kept inline only when the paste is stored as
 * HTML, where it belongs.
 */
function imageMarkdown(element: Element): string {
  const source = (element.getAttribute('src') ?? '').trim();
  if (!/^https?:\/\//i.test(source)) return '';
  const alt = (element.getAttribute('alt') ?? '').replaceAll('[', '').replaceAll(']', '');
  return `![${alt}](${source})`;
}

function cellText(cell: Element): string {
  return childrenInline(cell).replace(/\|/g, '\\|').replace(/[\s\u00a0]+/g, ' ').trim();
}

function tableMarkdown(table: Element): string {
  const rows: Element[] = [];
  table.querySelectorAll('tr').forEach((row) => rows.push(row));
  if (!rows.length) return '';
  const readRow = (row: Element): string[] => {
    const cells: string[] = [];
    row.querySelectorAll('th, td').forEach((cell) => cells.push(cellText(cell)));
    return cells;
  };
  const header = readRow(rows[0]);
  if (!header.length || header.every((cell) => !cell)) return '';
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows.slice(1)) {
    const cells = readRow(row);
    if (!cells.length || cells.every((cell) => !cell)) continue;
    while (cells.length < header.length) cells.push('');
    lines.push(`| ${cells.slice(0, header.length).join(' | ')} |`);
  }
  return lines.join('\n');
}

function listMarkdown(list: Element, indent: string): string {
  const items: string[] = [];
  const ordered = tagName(list) === 'ol';
  let index = 0;
  list.childNodes.forEach((child) => {
    if (tagName(child) !== 'li') return;
    index += 1;
    const marker = ordered ? `${index}. ` : '- ';
    const lines: string[] = [];
    let first = true;
    child.childNodes.forEach((part) => {
      const tag = tagName(part);
      if (tag === 'ul' || tag === 'ol') {
        lines.push(listMarkdown(part as Element, `${indent}  `));
        return;
      }
      if (DROPPED_TAGS.has(tag)) return;
      const text = tag === 'p' || TRANSPARENT_BLOCK_TAGS.has(tag) ? blockText(part as Element) : inlineText(part);
      const trimmed = text.replace(/^\n+/, '').replace(/\n+$/, '');
      if (!trimmed.trim()) return;
      if (first) {
        lines.push(`${indent}${marker}${trimmed.split('\n').join(`\n${indent}  `)}`);
        first = false;
      } else {
        lines.push(`${indent}  ${trimmed.split('\n').join(`\n${indent}  `)}`);
      }
    });
    if (lines.length) items.push(lines.join('\n'));
  });
  return items.join('\n');
}

/** Block text of a transparent container: its block children joined, or its inline text. */
function blockText(node: Element): string {
  const blocks = blocksMarkdown(node);
  return blocks || childrenInline(node).trim();
}

/** Blocks of a node, joined with blank lines. Returns '' when the node holds nothing convertible. */
function blocksMarkdown(node: Node): string {
  const blocks: string[] = [];
  node.childNodes.forEach((child) => {
    const block = blockMarkdown(child, '');
    if (block.trim()) blocks.push(block.trim());
  });
  return blocks.join('\n\n');
}

function blockMarkdown(node: Node, indent: string): string {
  if (node.nodeType === node.TEXT_NODE) {
    const text = collapseWhitespace(node.textContent ?? '').trim();
    return text;
  }
  if (node.nodeType !== node.ELEMENT_NODE) return '';
  const element = node as Element;
  const tag = tagName(node);
  if (DROPPED_TAGS.has(tag)) return '';
  if (/^h[1-6]$/.test(tag)) {
    const text = childrenInline(element).trim();
    return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
  }
  if (tag === 'p' || tag === 'figcaption') {
    return childrenInline(element).trim();
  }
  if (tag === 'ul' || tag === 'ol') return listMarkdown(element, indent);
  if (tag === 'li') return childrenInline(element).trim();
  if (tag === 'blockquote') {
    const inner = blocksMarkdown(element);
    if (!inner.trim()) return '';
    return inner
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n');
  }
  if (tag === 'pre') {
    const text = (element.textContent ?? '').replace(/\n+$/, '');
    return text ? `\`\`\`\n${text}\n\`\`\`` : '';
  }
  if (tag === 'hr') return '---';
  if (tag === 'table') return tableMarkdown(element);
  if (TRANSPARENT_BLOCK_TAGS.has(tag)) return blocksMarkdown(element);
  if (tag === 'br') return '';
  // Any other element (span, strong, a, img, …) at block level keeps its inline text.
  return childrenInline(element).trim();
}

/**
 * Plain text of HTML, with a line break after each block: the first line
 * names a paste, and the whole text is the plain-text form of an HTML
 * paste. Scripts, styles, and other non-content elements are skipped.
 */
export function htmlPlainText(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) return;
    node.childNodes.forEach(walk);
    if (
      tag === 'br' ||
      ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'pre', 'section', 'article', 'figure'].includes(
        tag,
      )
    )
      parts.push('\n');
  };
  template.content.childNodes.forEach(walk);
  return parts
    .join('')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert sanitized HTML to Markdown. Headings, lists, and tables become
 * Markdown; links, emphasis, and code keep their Markdown form; images
 * keep only a web address; everything with no Markdown equivalent is
 * dropped, and the surviving blocks are separated by blank lines.
 */
export function htmlToMarkdown(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const markdown = blocksMarkdown(template.content);
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}
