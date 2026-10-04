import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { sanitizeNoteHtml } from './sanitize-html';

export function markdownToHtml(source: string, render: (source: string) => string) {
  return DOMPurify.sanitize(render(source));
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
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
      return `\`${content.replace(/`/g, '\\`')}\``;
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
      .map(
        (item, index) =>
          `${tag === 'ol' ? `${index + 1}.` : '-'} ${Array.from(item.childNodes, inlineMarkdown).join('').trim()}`,
      );
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
    return sanitizeNoteHtml(
      markdownToHtml(source, (value) => markdown.render(value)),
      targetPath,
    );
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
  return `Create a ${to.toUpperCase()} sibling copy and keep the original? ${
    details.length
      ? `Possible losses: ${details.join('; ')}.`
      : 'Unsupported formatting outside the supported semantic subset may not carry over.'
  }`;
}
