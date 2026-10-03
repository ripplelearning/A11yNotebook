// Renders notes as sanitized semantic Markdown or a native textarea for editing.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { VaultLink } from '../../../shared/types';

function createMarkdown(links: VaultLink[]) {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
  markdown.inline.ruler.before('link', 'wiki_link', (state, silent) => {
    const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const title = match[1].trim();
      const label = match[2]?.trim() || title;
      const resolved = links.find(
        (link) => link.targetTitle.toLocaleLowerCase() === title.toLocaleLowerCase() && link.resolved,
      );
      const open = state.push('link_open', 'a', 1);
      open.attrs = [['href', `#wiki:${encodeURIComponent(title)}`]];
      if (!resolved) {
        open.attrSet('class', 'missing-note');
        open.attrSet('aria-label', `${label}, missing note`);
      }
      const text = state.push('text', '', 0);
      text.content = label;
      const close = state.push('link_close', 'a', -1);
      close.block = false;
    }
    state.pos += match[0].length;
    return true;
  });
  return markdown;
}

interface MarkdownDocumentProps {
  content: string;
  mode: 'read-only' | 'edit';
  links: VaultLink[];
  onChange: (content: string) => void;
  onNavigate: (href: string) => void;
}

/** Render safe browse-mode HTML or expose the unformatted Markdown source editor. */
export default function MarkdownDocument({ content, mode, links, onChange, onNavigate }: MarkdownDocumentProps) {
  if (mode === 'edit') {
    return (
      <label className="editor-label">
        Markdown source
        <textarea
          aria-label="Markdown source"
          className="markdown-editor"
          value={content}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  const html = DOMPurify.sanitize(createMarkdown(links).render(content));
  return (
    <div
      className="document-body markdown-body"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (href && !(href.startsWith('#') && !href.startsWith('#wiki:'))) {
          event.preventDefault();
          onNavigate(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
