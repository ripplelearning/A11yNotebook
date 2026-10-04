// Renders notes as sanitized semantic Markdown or a native textarea for editing.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { useState, type RefObject } from 'react';
import type { VaultLink } from '../../../shared/types';
import type { VaultTask } from '../../../shared/types';
import { imageUrl } from '../../../shared/attachments';
import RichTextEditor from './RichTextEditor';
import { htmlToMarkdown, markdownToHtml } from './format-conversion';
import { sanitizeNoteHtml } from './sanitize-html';

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
  onOpenExternal?: (url: string) => void;
  editorRef?: RefObject<HTMLTextAreaElement>;
  notePath?: string;
  format?: 'markdown' | 'html';
  disabled?: boolean;
  htmlTasks?: VaultTask[];
  onToggleHtmlTask?: (taskId: string) => void;
}

/** Render safe browse-mode HTML or expose the unformatted Markdown source editor. */
export default function MarkdownDocument({
  content,
  mode,
  links,
  onChange,
  onNavigate,
  onOpenExternal,
  editorRef,
  notePath,
  format = 'markdown',
  disabled,
  htmlTasks = [],
  onToggleHtmlTask,
}: MarkdownDocumentProps) {
  const [richText, setRichText] = useState(false);
  if (mode === 'edit') {
    return (
      <>
        <div role="group" aria-label="Editing mode">
          <button type="button" aria-pressed={!richText} onClick={() => setRichText(false)}>
            Plain source
          </button>
          <button type="button" aria-pressed={richText} onClick={() => setRichText(true)}>
            Rich text
          </button>
        </div>
        {richText ? (
          <RichTextEditor
            content={
              format === 'html'
                ? sanitizeNoteHtml(content, notePath)
                : markdownToHtml(content, (source) => createMarkdown(links, notePath).render(source))
            }
            notePath={notePath ?? ''}
            onChange={(value) =>
              onChange(format === 'html' ? sanitizeNoteHtml(value, notePath) : htmlToMarkdown(value))
            }
          />
        ) : (
          <label className="editor-label">
            {format === 'html' ? 'HTML source' : 'Markdown source'}
            <textarea
              ref={editorRef}
              disabled={disabled}
              data-context="editor-selection"
              data-path={notePath}
              aria-label={format === 'html' ? 'HTML source' : 'Markdown source'}
              className="markdown-editor"
              value={content}
              onChange={(event) =>
                onChange(format === 'html' ? sanitizeNoteHtml(event.target.value, notePath) : event.target.value)
              }
            />
          </label>
        )}
      </>
    );
  }

  const html =
    format === 'html'
      ? sanitizeNoteHtml(content, notePath)
      : DOMPurify.sanitize(createMarkdown(links, notePath).render(content), {
          ADD_URI_SAFE_ATTR: [],
          ALLOWED_URI_REGEXP: /^(?:(?:vault-file|https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
        });
  const renderedHtml =
    format === 'html' && mode === 'read-only' && htmlTasks.length
      ? (() => {
          const template = document.createElement('template');
          template.innerHTML = html;
          const byTaskId = new Map(htmlTasks.filter((task) => task.taskId).map((task) => [task.taskId!, task]));
          template.content.querySelectorAll<HTMLLIElement>('li[data-a11y-task-id]').forEach((item) => {
            const task = byTaskId.get(item.dataset.a11yTaskId ?? '');
            if (!task?.taskId) return;
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.setAttribute('role', 'checkbox');
            toggle.setAttribute('aria-checked', String(task.complete));
            toggle.setAttribute('aria-label', `${task.complete ? 'Mark incomplete' : 'Mark complete'}: ${task.text}`);
            toggle.dataset.htmlTaskId = task.taskId;
            toggle.dataset.taskId = task.taskId;
            toggle.dataset.context = 'task-row';
            toggle.dataset.path = task.path;
            toggle.textContent = task.complete ? 'Completed' : 'Incomplete';
            item.insertBefore(toggle, item.firstChild);
          });
          return template.innerHTML;
        })()
      : html;
  return (
    <div
      className="document-body markdown-body"
      onClick={(event) => {
        const taskToggle = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-html-task-id]');
        if (taskToggle) {
          event.preventDefault();
          const id = taskToggle.dataset.htmlTaskId;
          if (id) onToggleHtmlTask?.(id);
          return;
        }
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (!href || (href.startsWith('#') && !href.startsWith('#wiki:'))) return;
        event.preventDefault();
        const scheme = /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1].toLowerCase();
        if (scheme) {
          if (['http', 'https', 'mailto'].includes(scheme)) onOpenExternal?.(href);
          return;
        }
        onNavigate(href);
      }}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
