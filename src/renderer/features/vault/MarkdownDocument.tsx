// Renders notes as sanitized semantic Markdown or a native textarea for editing.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { RefObject } from 'react';
import type { VaultLink } from '../../../shared/types';
import { imageUrl } from '../../../shared/attachments';

function createMarkdown(links: VaultLink[], notePath?: string) {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const renderImage = markdown.renderer.rules.image!;
  markdown.renderer.rules.image = (tokens, index, options, environment, renderer) => {
    const href = String(tokens[index].attrGet('src') ?? '');
    const parts = notePath?.split('/').slice(0, -1) ?? [];
    try {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href)) throw new Error('External image.');
      for (const part of decodeURIComponent(href).split('/')) {
        if (part === '..') {
          if (!parts.length) throw new Error('Outside vault.');
          parts.pop();
        } else if (part && part !== '.') parts.push(part);
      }
      const relative = parts.join('/');
      if (!/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(relative)) throw new Error('Unsupported image.');
      tokens[index].attrSet('src', imageUrl(relative));
    } catch {
      tokens[index].attrSet('src', '');
    }
    return renderImage(tokens, index, options, environment, renderer);
  };
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
  editorRef?: RefObject<HTMLTextAreaElement>;
  notePath?: string;
  disabled?: boolean;
}

/** Render safe browse-mode HTML or expose the unformatted Markdown source editor. */
export default function MarkdownDocument({
  content,
  mode,
  links,
  onChange,
  onNavigate,
  editorRef,
  notePath,
  disabled,
}: MarkdownDocumentProps) {
  if (mode === 'edit') {
    return (
      <label className="editor-label">
        Markdown source
        <textarea
          ref={editorRef}
          disabled={disabled}
          aria-label="Markdown source"
          className="markdown-editor"
          value={content}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  const html = DOMPurify.sanitize(createMarkdown(links, notePath).render(content), {
    ADD_URI_SAFE_ATTR: [],
    ALLOWED_URI_REGEXP: /^(?:(?:vault-file|https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });
  return (
    <div
      className="document-body markdown-body"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (href) {
          event.preventDefault();
          onNavigate(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
