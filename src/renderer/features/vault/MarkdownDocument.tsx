// Renders notes as sanitized semantic Markdown or a native textarea for editing.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { VaultLink } from '../../../shared/types';
import type { VaultTask } from '../../../shared/types';
import { attachmentPathFromUrl, imageUrl } from '../../../shared/attachments';
import { extractPastedImageDescription } from '../../../shared/paste-content';
import { KNOWN_TEMPLATE_PLACEHOLDERS, parseTemplateFields, type TemplateField } from '../../../shared/template-fields';
import PlainTextDocument from './PlainTextDocument';
import RichTextEditor from './RichTextEditor';
import { expandMathSpans, htmlToMarkdown, markdownImageReference, markdownToHtml } from './format-conversion';
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

const KNOWN_PLACEHOLDERS = new Set<string>(KNOWN_TEMPLATE_PLACEHOLDERS);

/**
 * Reading view renders a template's {{Name}} markers as fillable
 * textboxes. The six known placeholders are left as literal text; every
 * other marker becomes an <input> whose accessible name is the field
 * name (numbered when the name repeats: "Client Name 1", "Client Name
 * 2"). The walk only visits visible text: markers inside <code> or
 * <pre> stay literal, matching parseTemplateFields, which skips fenced
 * and inline code when the note is saved.
 *
 * Inputs are built through the DOM after sanitizing, like the Markdown
 * task checkboxes, so a typed value can never inject markup. Values
 * are owned by the parent (templateFieldValues) and reported through
 * onTemplateFieldChange; the parent never re-renders on a keystroke,
 * so typing never steals focus by replacing the rendered HTML.
 * Without a change handler the inputs render disabled, display-only.
 */
function renderTemplateFields(
  html: string,
  fields: TemplateField[],
  values: readonly string[],
  editable: boolean,
): string {
  if (!fields.length) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement;
    if (parent?.closest('code, pre, script, style, textarea')) continue;
    textNodes.push(node);
  }
  // Match each rendered marker to the next unclaimed field with the same
  // name, so a marker the raw scan counted but the renderer did not
  // (for example one inside a link destination) can never shift a label
  // or a value onto a different field.
  const byName = new Map<string, TemplateField[]>();
  for (const field of fields) {
    const list = byName.get(field.name) ?? [];
    list.push(field);
    byName.set(field.name, list);
  }
  const seen = new Map<string, number>();
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    if (!text.includes('{{')) continue;
    const fragment = document.createDocumentFragment();
    let previous = 0;
    let replaced = false;
    for (const match of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const name = match[1].trim();
      if (!name || KNOWN_PLACEHOLDERS.has(name)) continue;
      const occurrence = (seen.get(name) ?? 0) + 1;
      seen.set(name, occurrence);
      const field = byName.get(name)?.shift();
      const label = field?.label ?? (occurrence > 1 ? `${name} ${occurrence}` : name);
      const value = field ? (values[field.index] ?? '') : '';
      fragment.append(document.createTextNode(text.slice(previous, match.index)));
      const input = document.createElement('input');
      input.type = 'text';
      if (field) input.dataset.templateFieldIndex = String(field.index);
      input.setAttribute('aria-label', label);
      input.setAttribute('value', value);
      if (!editable) input.disabled = true;
      fragment.append(input);
      previous = match.index + match[0].length;
      replaced = true;
    }
    if (!replaced) continue;
    fragment.append(document.createTextNode(text.slice(previous)));
    textNode.replaceWith(fragment);
  }
  return template.innerHTML;
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
    // A library picture the editor round trip wrote as a library URL:
    // resolve it back to its library path instead of treating the
    // scheme as an external image and blanking it. Only a safe library
    // reference resolves; anything else falls through to the checks
    // below, so a crafted URL still cannot climb out of the library.
    const stored = attachmentPathFromUrl(href);
    if (stored) {
      if (/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(stored)) tokens[index].attrSet('src', imageUrl(stored));
      else tokens[index].attrSet('src', '');
      return renderImage(tokens, index, options, environment, renderer);
    }
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
  /** Typed values for the note's {{Name}} template fields, in field order. */
  templateFieldValues?: string[];
  /** Called with the field index and typed value; absent keeps the field inputs disabled. */
  onTemplateFieldChange?: (index: number, value: string) => void;
  /** Status announcements for automatic edits, such as list continuation. */
  announce?: (message: string) => void;
  /**
   * Store a picture pasted into a note beside the note and return its
   * inline reference; wired for HTML and Markdown notes alike. In a
   * Markdown note the reference is written back as a relative image
   * reference, so the picture renders in the reading view.
   */
  onPasteImage?: (
    notePath: string,
    file: File,
    description: string | undefined,
  ) => Promise<{ src: string; alt: string } | null>;
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
  templateFieldValues = [],
  onTemplateFieldChange,
  announce,
  onPasteImage,
  hideModeToggle = false,
}: MarkdownDocumentProps) {
  const [richText, setRichText] = useState(false);
  // Template field inputs live inside dangerouslySetInnerHTML, so
  // React's synthetic onChange never fires for them (its value tracker
  // only knows elements React created). A native 'input' listener on
  // the reading container catches their typing instead.
  const readingRef = useRef<HTMLDivElement | null>(null);
  const templateFieldChangeRef = useRef(onTemplateFieldChange);
  useEffect(() => {
    templateFieldChangeRef.current = onTemplateFieldChange;
  });
  useEffect(() => {
    const element = readingRef.current;
    if (!element) return;
    const handler = (event: Event) => {
      const input = (event.target as HTMLElement | null)?.closest?.(
        'input[data-template-field-index]',
      ) as HTMLInputElement | null;
      if (!input) return;
      const index = Number(input.dataset.templateFieldIndex);
      if (Number.isInteger(index)) templateFieldChangeRef.current?.(index, input.value);
    };
    element.addEventListener('input', handler);
    return () => {
      element.removeEventListener('input', handler);
    };
  });
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
            onPasteImage={
              (format === 'html' || format === 'markdown') && onPasteImage
                ? (file, description) => onPasteImage(notePath ?? '', file, description)
                : undefined
            }
            onChange={(value) =>
              onChange(
                format === 'html' ? sanitizeNoteHtml(value, notePath) : htmlToMarkdown(value, notePath),
              )
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
              onPaste={async (event) => {
                // A picture pasted into Markdown or HTML source has no
                // editor to catch it: store it beside the note and insert
                // the inline reference at the caret, keeping the
                // description the source provides. Anything that is not
                // a picture falls through to the browser's default paste.
                // (HTML notes open in this source view by default — the
                // rich-text editor's own paste handler only runs after
                // switching to Rich text — so without this branch a
                // picture pasted into an open HTML note landed nowhere.)
                if ((format !== 'markdown' && format !== 'html') || !onPasteImage || !notePath) return;
                const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
                  item.type.startsWith('image/'),
                );
                if (!file) return;
                event.preventDefault();
                const description = extractPastedImageDescription(
                  event.clipboardData?.getData('text/html') ?? '',
                );
                const area = event.currentTarget;
                const start = area.selectionStart ?? area.value.length;
                const end = area.selectionEnd ?? start;
                const inserted = await onPasteImage(notePath, file, description);
                if (!inserted) return;
                let caret: number;
                if (format === 'markdown') {
                  const reference = markdownImageReference(inserted.alt, inserted.src);
                  onChange(area.value.slice(0, start) + reference + area.value.slice(end));
                  caret = start + reference.length;
                } else {
                  // HTML source: insert the inline image element at the
                  // caret. The element is built through the DOM so a
                  // description with quotes or ampersands stays intact,
                  // and the sanitizer rewrites its note-relative path to
                  // the library URL the note stores, as for typed edits.
                  const image = document.createElement('img');
                  image.setAttribute('src', inserted.src);
                  image.setAttribute('alt', inserted.alt);
                  const snippet = sanitizeNoteHtml(image.outerHTML, notePath);
                  if (!snippet) return;
                  const next = area.value.slice(0, start) + snippet + area.value.slice(end);
                  const sanitized = sanitizeNoteHtml(next, notePath);
                  onChange(sanitized);
                  const at = sanitized.indexOf(snippet, start);
                  caret = (at === -1 ? start : at) + snippet.length;
                }
                // The parent re-renders the controlled textarea with the
                // new value; restore the caret after that render lands.
                window.setTimeout(() => {
                  if (document.contains(area)) area.setSelectionRange(caret, caret);
                }, 0);
              }}
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
  // Template fields render in the reading view only (editing mode shows
  // the raw {{Name}} markers). Markdown and HTML notes share this path:
  // both render to sanitized HTML first, and the field walk replaces
  // markers in visible text for either format.
  const withTemplateFields =
    mode === 'read-only' && (format === 'markdown' || format === 'html')
      ? renderTemplateFields(
          renderedHtml,
          parseTemplateFields(content, format),
          templateFieldValues,
          onTemplateFieldChange !== undefined,
        )
      : renderedHtml;
  return (
    <div
      ref={readingRef}
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
      dangerouslySetInnerHTML={{ __html: withTemplateFields }}
    />
  );
}
