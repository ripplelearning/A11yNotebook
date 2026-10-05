import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { sanitizeNoteHtml } from './sanitize-html';

const MARKDOWN_SPECIAL_CHARACTERS = new Set('\\`*_{}[]()#+.!|>-');

function markdownCodeSpan(value: string) {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), ([run]) => run.length));
  const delimiter = '`'.repeat(longestRun + 1);
  const content = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
  return `${delimiter}${content}${delimiter}`;
}

export function markdownToHtml(source: string, render: (source: string) => string) {
  return DOMPurify.sanitize(render(source));
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return Array.from(node.textContent ?? '', (character) =>
      MARKDOWN_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character,
    ).join('');
  }
  if (!(node instanceof HTMLElement)) return '';
  const content = Array.from(node.childNodes, inlineMarkdown).join('');
  switch (node.tagName.toLowerCase()) {
    case 'strong':
    case 'b':
      return `**${content}**`;
    case 'em':
    case 'i':
      return `*${content}*`;
    case 'del':
    case 's':
    case 'strike':
      return `~~${content}~~`;
    case 'code':
      return markdownCodeSpan(node.textContent ?? '');
    case 'a': {
      const href = node.getAttribute('href') ?? '';
      const wiki = href.startsWith('#wiki:') ? `[[${decodeURIComponent(href.slice(6))}]]` : `[${content}](${href})`;
      return wiki;
    }
    case 'img':
      return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`;
    case 'u':
      return `<u>${content}</u>`;
    default:
      return content;
  }
}

function blockMarkdown(node: Node): string {
  if (!(node instanceof HTMLElement)) return inlineMarkdown(node);
  const tag = node.tagName.toLowerCase();
  if (!/^(?:h[1-6]|p|blockquote|pre|ul|ol|table|div|body|main|section|article)$/.test(tag)) return inlineMarkdown(node);
  const content = Array.from(node.childNodes, blockMarkdown).join('');
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${content.trim()}`;
  if (tag === 'p') return content.trim();
  if (tag === 'blockquote')
    return content
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  if (tag === 'pre') return `\`\`\`\n${node.textContent ?? ''}\n\`\`\``;
  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(node.children)
      .filter((item) => item.tagName.toLowerCase() === 'li')
      .map((item, index) => {
        const content = Array.from(item.childNodes, inlineMarkdown).join('').trim();
        const task = item.getAttribute('data-a11y-task-id');
        if (!task) return `${tag === 'ol' ? `${index + 1}.` : '-'} ${content}`;
        const checked = item.getAttribute('data-a11y-task-complete') === 'true';
        const due = item.getAttribute('data-a11y-task-due');
        const priority = item.getAttribute('data-a11y-task-priority');
        const reminder = item.getAttribute('data-a11y-task-remind');
        return `- [${checked ? 'x' : ' '}] ${content}${due ? ` due:${due}` : ''}${priority ? ` priority:${priority}` : ''}${reminder ? ` remind:${reminder}` : ''} <!-- a11y-task-id:${task} -->`;
      });
    return items.join('\n');
  }
  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr')).map(
      (row) =>
        `| ${Array.from(row.children, (cell) => Array.from(cell.childNodes, inlineMarkdown).join('').trim()).join(' | ')} |`,
    );
    if (rows.length > 1)
      rows.splice(1, 0, `| ${Array.from(node.querySelector('tr')?.children ?? [], () => '---').join(' | ')} |`);
    return rows.join('\n');
  }
  if (['div', 'body', 'main', 'section', 'article'].includes(tag)) {
    return Array.from(node.childNodes, blockMarkdown)
      .map((block) => block.trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return content;
}

export function htmlToMarkdown(source: string) {
  const container = document.createElement('div');
  container.innerHTML = DOMPurify.sanitize(source);
  return Array.from(container.childNodes, blockMarkdown)
    .map((block) => block.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function convertNoteContent(
  source: string,
  from: 'markdown' | 'html',
  to: 'markdown' | 'html',
  targetPath: string,
) {
  if (from === to) return source;
  if (to === 'html') {
    const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
    markdown.inline.ruler.before('link', 'wiki_link', (state, silent) => {
      const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(state.src.slice(state.pos));
      if (!match) return false;
      if (!silent) {
        const title = match[1].trim();
        const label = match[2]?.trim() || title;
        const open = state.push('link_open', 'a', 1);
        open.attrs = [['href', `#wiki:${encodeURIComponent(title)}`]];
        const text = state.push('text', '', 0);
        text.content = label;
        state.push('link_close', 'a', -1);
      }
      state.pos += match[0].length;
      return true;
    });
    const html = sanitizeNoteHtml(
      markdownToHtml(source, (value) => markdown.render(value)),
      targetPath,
    );
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll<HTMLLIElement>('li').forEach((item) => {
      const originalText = item.textContent ?? '';
      const checkbox = /^\s*\[([ xX])\]\s*/.exec(originalText);
      if (!checkbox) return;
      const due = originalText.match(/(?:📅\s*|due:)(\d{4}-\d{2}-\d{2})/i)?.[1];
      const priority = originalText.match(/priority:(low|normal|high|urgent)\b/i)?.[1]?.toLowerCase();
      const reminder = originalText.match(/remind:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/i)?.[1];
      const stableId = /<!--\s*a11y-task-id:([\w-]{8,80})\s*-->/.exec(originalText)?.[1];
      item.setAttribute('data-a11y-task-id', stableId ?? crypto.randomUUID());
      item.setAttribute('data-a11y-task-complete', String(checkbox[1].toLowerCase() === 'x'));
      if (due) item.setAttribute('data-a11y-task-due', due);
      if (priority) item.setAttribute('data-a11y-task-priority', priority);
      if (reminder) item.setAttribute('data-a11y-task-remind', reminder);
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      let prefix = true;
      while (textNode) {
        let current = textNode.textContent ?? '';
        if (prefix) current = current.replace(/^\s*\[[ xX]\]\s*/, '');
        textNode.textContent = current
          .replace(/<!--\s*a11y-task-id:[\w-]{8,80}\s*-->/g, '')
          .replace(/(?:📅\s*|due:)\d{4}-\d{2}-\d{2}/gi, '')
          .replace(/priority:(?:low|normal|high|urgent)\b/gi, '')
          .replace(/remind:\d{4}-\d{2}-\d{2} \d{2}:\d{2}/gi, '');
        prefix = false;
        textNode = walker.nextNode();
      }
    });
    return sanitizeNoteHtml(template.innerHTML, targetPath);
  }
  return htmlToMarkdown(source);
}

export function formatConversionWarning(source: string, from: 'markdown' | 'html', to: 'markdown' | 'html') {
  const losses =
    from === 'html'
      ? [
          /<(?:script|style|form|iframe|object|embed|video|audio|svg|math)\b/i.test(source)
            ? 'active or embedded HTML content is not retained'
            : '',
          /\b(?:style|class|colspan|rowspan|data-[\w-]+)\s*=/i.test(source)
            ? 'CSS classes, inline styling, custom attributes, and complex table layout may be lost'
            : '',
          /<img\b/i.test(source) ? 'image references may need manual adjustment' : '',
        ]
      : [/<[a-z][^>]*>/i.test(source) ? 'raw HTML is not rendered in the converted note' : ''];
  const details = losses.filter(Boolean);
  if (/data-a11y-task-id\s*=|<!--\s*a11y-task-id:/i.test(source)) {
    details.push('task identities are copied, but milestone associations remain with the original note');
  }
  return `Create a ${to.toUpperCase()} sibling copy and keep the original? ${
    details.length
      ? `Possible losses: ${details.join('; ')}.`
      : 'Unsupported formatting outside the supported semantic subset may not carry over.'
  }`;
}
