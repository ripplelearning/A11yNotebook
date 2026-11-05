// Renders notes as sanitized semantic Markdown or a native textarea for editing.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { useState, type RefObject } from 'react';
import type { VaultLink } from '../../../shared/types';
import type { VaultTask } from '../../../shared/types';
import { imageUrl } from '../../../shared/attachments';
import PlainTextDocument from './PlainTextDocument';
import RichTextEditor from './RichTextEditor';
import { expandMathSpans, htmlToMarkdown, markdownToHtml } from './format-conversion';
import { sanitizeNoteHtml } from './sanitize-html';
import { continueMarkdownList } from './smart-formatting';

/**
 * Reading view renders Markdown task items as real checkboxes. markdown-it
 * core has no task-list support, so without this step `- [ ] do this`
 * renders as the literal text "[ ] do this" instead of a checkbox.
 * When a toggle handler is provided, the checkboxes are enabled: each one
 * carries the 1-based source line of its task, so activating it toggles
 * that task (and the Tasks view) through the same path as Tasks view.
 * Without a handler (editors, locked or protected notes) they stay
 * disabled and display-only. The aria-label matches the disabled
 * checklist inputs the HTML sanitizer already emits for HTML notes.
 *
 * Task lines come from the markdown-it token stream, not a source scan,
 * so fenced code and other non-list content can never shift the mapping:
 * list items render in token order, and so do these lines.
 */
function markdownTaskLines(markdown: InstanceType<typeof MarkdownIt>, content: string): number[] {
  const lines: number[] = [];
  let tokens: ReturnType<InstanceType<typeof MarkdownIt>['parse']> = [];
  try {
    tokens = markdown.parse(content, {});
  } catch {
    return lines;
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'list_item_open' || !token.map) continue;
    for (let inner = index + 1; inner < tokens.length; inner += 1) {
      const item = tokens[inner];
      if (item.type === 'inline') {
        if (/^\[([ xX])\]\s*/.test(item.content)) lines.push(token.map[0] + 1);
        break;
      }
      if (item.type === 'list_item_close') break;
    }
  }
  return lines;
}

function renderMarkdownTaskCheckboxes(html: string, lines: number[], toggleable: boolean): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  let taskIndex = 0;
  template.content.querySelectorAll('li').forEach((item) => {
    // The marker lives in the item's own first content: a direct text child
    // for tight lists, or the first text inside a leading <p> for loose
    // lists (whose <li> starts with a whitespace text node). Only the
    // first content child is considered, so a parent item never inherits
    // a nested item's marker.
    let markerNode: Text | null = null;
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if ((child.textContent ?? '').trim() === '') continue;
        markerNode = child as Text;
      } else if (child instanceof HTMLParagraphElement) {
        markerNode =
          (Array.from(child.childNodes).find((node) => node.nodeType === Node.TEXT_NODE) as Text | undefined) ??
          null;
      }
      break;
    }
    if (!markerNode) return;
    const match = /^\s*\[([ xX])\]\s*/.exec(markerNode.textContent ?? '');
    if (!match) return;
    markerNode.textContent = (markerNode.textContent ?? '').replace(/^\s*\[[ xX]\]\s*/, '');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const line = lines[taskIndex];
    taskIndex += 1;
    const checked = match[1].toLowerCase() === 'x';
    if (toggleable && line !== undefined) {
      checkbox.dataset.markdownTaskLine = String(line);
      const label = item.textContent?.trim();
      checkbox.setAttribute('aria-label', label ? `Mark ${checked ? 'incomplete' : 'complete'}: ${label}` : 'Checklist item');
    } else {
      checkbox.disabled = true;
      checkbox.setAttribute('aria-label', 'Checklist item');
    }
    if (checked) {
      // Set the attribute, not just the property: the property does not
      // survive serializing the template back to an HTML string.
      checkbox.setAttribute('checked', '');
      checkbox.checked = true;
    }
    item.insertBefore(checkbox, item.firstChild);
  });
  return template.innerHTML;
}

function createMarkdown(links: VaultLink[], notePath?: string) {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
  // Chicago notes-bibliography footnotes ([^1] markers with definitions)
  // render as superscript links plus a notes section in reading view.
  markdown.use(footnote);
  const renderImage = markdown.renderer.rules.image!;
  markdown.renderer.rules.image = (tokens, index, options, environment, renderer) => {
    const href = String(tokens[index].attrGet('src') ?? '');
    const parts = notePath?.split('/').slice(0, -1) ?? [];
    try {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href)) throw new Error('External image.');
      for (const part of decodeURIComponent(href).split('/')) {
        if (part === '..') {
          if (!parts.length) throw new Error('Outside library.');
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
  format?: 'markdown' | 'html' | 'text';
  disabled?: boolean;
  htmlTasks?: VaultTask[];
  onToggleHtmlTask?: (taskId: string) => void;
  /** Reading-view Markdown task toggle: called with the 1-based source line. Absent keeps checkboxes disabled. */
  onToggleMarkdownTask?: (line: number) => void;
  /** Status announcements for automatic edits, such as list continuation. */
  announce?: (message: string) => void;
  /** Focus Mode shows only the document: hide the editing-mode toggle. */
  hideModeToggle?: boolean;
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
  onToggleMarkdownTask,
  announce,
  hideModeToggle = false,
}: MarkdownDocumentProps) {
  const [richText, setRichText] = useState(false);
  if (mode === 'edit' && format === 'text') {
    // Plain-text notes have no rich-text form; the textarea is the editor.
    return (
      <label className="editor-label">
        Plain text source
        <textarea
          ref={editorRef}
          disabled={disabled}
          data-context="editor-selection"
          data-path={notePath}
          aria-label="Plain text source"
          className="markdown-editor"
          value={content}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }
  if (mode === 'edit') {
    return (
      <>
        {!hideModeToggle ? (
          <div role="group" aria-label="Editing mode">
            <button type="button" aria-pressed={!richText} onClick={() => setRichText(false)}>
              Plain source
            </button>
            <button type="button" aria-pressed={richText} onClick={() => setRichText(true)}>
              Rich text
            </button>
          </div>
        ) : null}
        {richText ? (
          <RichTextEditor
            content={
              format === 'html'
                ? expandMathSpans(sanitizeNoteHtml(content, notePath))
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
              onKeyDown={(event) => {
                if (format !== 'markdown' || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)
                  return;
                const area = event.currentTarget;
                const continued = continueMarkdownList(area.value, area.selectionStart, area.selectionEnd);
                if (!continued) return;
                event.preventDefault();
                onChange(continued.value);
                announce?.(continued.announcement);
                // The parent re-renders the controlled textarea with the new
                // value; restore the caret after that render lands.
                window.setTimeout(() => {
                  if (document.contains(area)) area.setSelectionRange(continued.caret, continued.caret);
                }, 0);
              }}
            />
          </label>
        )}
      </>
    );
  }

  if (format === 'text') {
    // Reading view for plain text: real paragraphs, never Markdown parsing,
    // so hashes, asterisks, and line breaks keep their literal meaning.
    return (
      <div className="document-body markdown-body" data-context="reading-document" data-path={notePath}>
        <PlainTextDocument text={content} />
      </div>
    );
  }

  const html =
    format === 'html'
      ? expandMathSpans(sanitizeNoteHtml(content, notePath))
      : expandMathSpans(
          DOMPurify.sanitize(createMarkdown(links, notePath).render(content), {
            ADD_URI_SAFE_ATTR: [],
            ALLOWED_URI_REGEXP: /^(?:(?:vault-file|https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
          }),
        );
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
      : format === 'markdown' && mode === 'read-only'
        ? renderMarkdownTaskCheckboxes(
            html,
            markdownTaskLines(createMarkdown(links, notePath), content),
            onToggleMarkdownTask !== undefined,
          )
        : html;
  return (
    <div
      className="document-body markdown-body"
      onClick={(event) => {
        const markdownCheckbox = (event.target as HTMLElement).closest<HTMLInputElement>(
          'input[data-markdown-task-line]',
        );
        if (markdownCheckbox) {
          // Let state drive the visual state: the re-render after a
          // successful toggle flips the marker, and a failed toggle
          // leaves the checkbox exactly as it was.
          event.preventDefault();
          const line = Number(markdownCheckbox.dataset.markdownTaskLine);
          if (line) onToggleMarkdownTask?.(line);
          return;
        }
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
