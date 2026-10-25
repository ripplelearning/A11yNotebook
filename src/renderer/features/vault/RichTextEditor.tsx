import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { sanitizeNoteHtml } from './sanitize-html';
import { detectSmartTrigger } from './smart-formatting';

interface Props {
  content: string;
  notePath: string;
  onChange: (content: string) => void;
}

const tools = [
  { label: 'Bold', command: 'bold' },
  { label: 'Italic', command: 'italic' },
  { label: 'Underline', command: 'underline' },
  { label: 'Strikethrough', command: 'strikeThrough' },
  ...Array.from({ length: 6 }, (_, index) => ({ label: `Heading ${index + 1}`, command: `heading${index + 1}` })),
  { label: 'Bulleted list', command: 'insertUnorderedList' },
  { label: 'Numbered list', command: 'insertOrderedList' },
  { label: 'Block quote', command: 'quote' },
  { label: 'Code block', command: 'code' },
  { label: 'Insert link', command: 'link' },
  { label: 'Insert table', command: 'table' },
  { label: 'Insert image', command: 'image' },
  { label: 'Insert checklist task', command: 'task' },
];

export default function RichTextEditor({ content, notePath, onChange }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState(0);
  const safeContent = sanitizeNoteHtml(content, notePath);

  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== safeContent) editor.current.innerHTML = safeContent;
  }, [safeContent]);

  const activate = (command: string) => {
    const target = editor.current;
    if (!target) return;
    target.focus();
    if (command.startsWith('heading')) {
      document.execCommand('formatBlock', false, `h${command.slice('heading'.length)}`);
    } else if (command === 'quote') {
      document.execCommand('formatBlock', false, 'blockquote');
    } else if (command === 'code') {
      document.execCommand('formatBlock', false, 'pre');
    } else if (command === 'link') {
      const url = window.prompt('Link address');
      if (url?.trim()) document.execCommand('createLink', false, url.trim());
    } else if (command === 'table') {
      document.execCommand(
        'insertHTML',
        false,
        '<table><thead><tr><th scope="col">Column 1</th><th scope="col">Column 2</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table>',
      );
    } else if (command === 'image') {
      const source = window.prompt('Library image path');
      if (source?.trim()) {
        const alt = window.prompt('Image description (required)')?.trim();
        if (alt) {
          const image = document.createElement('img');
          image.setAttribute('src', source.trim());
          image.setAttribute('alt', alt);
          target.append(image);
        }
      }
    } else if (command === 'task') {
      const id = crypto.randomUUID();
      document.execCommand(
        'insertHTML',
        false,
        `<ul><li data-a11y-task-id="${id}" data-a11y-task-complete="false" data-a11y-task-due="" data-a11y-task-priority="normal">Task</li></ul>`,
      );
    } else {
      document.execCommand(command);
    }
    const next = sanitizeNoteHtml(target.innerHTML, notePath);
    if (target.innerHTML !== next) target.innerHTML = next;
    onChange(next);
  };

  const emitChange = () => {
    if (!editor.current) return;
    const next = sanitizeNoteHtml(editor.current.innerHTML, notePath);
    if (editor.current.innerHTML !== next) editor.current.innerHTML = next;
    onChange(next);
  };

  useEffect(() => {
    const insertText = (event: Event) => {
      const target = editor.current;
      if (!target) return;
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      target.focus();
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !target.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      document.execCommand('insertText', false, text);
      emitChange();
    };
    window.addEventListener('a11y:insert-citation-text', insertText);
    return () => window.removeEventListener('a11y:insert-citation-text', insertText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = editor.current;
    if (!target) return;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return;
    const anchor = selection.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
    const listItem = anchorElement?.closest('li');

    if (event.key === 'Enter' && listItem && listItem.textContent?.trim() === '') {
      // Second Enter, on the empty item a first Enter created: leave the list.
      event.preventDefault();
      const list = listItem.closest('ol, ul');
      document.execCommand(list?.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
      emitChange();
      return;
    }

    if (event.key !== ' ' || listItem) return;
    const block = anchorElement?.closest('p, div, h1, h2, h3, h4, h5, h6, blockquote, pre');
    if (!block || !target.contains(block) || block.tagName === 'PRE') return;
    const beforeRange = document.createRange();
    beforeRange.setStart(block, 0);
    beforeRange.setEnd(selection.anchorNode, selection.anchorOffset);
    const trigger = detectSmartTrigger(beforeRange.toString());
    if (!trigger) return;
    event.preventDefault();
    beforeRange.deleteContents();
    if (trigger.type === 'heading') {
      document.execCommand('formatBlock', false, `h${trigger.level}`);
    } else if (trigger.type === 'ordered') {
      document.execCommand('insertOrderedList');
      const list = selection.anchorNode instanceof Element
        ? selection.anchorNode.closest('ol')
        : selection.anchorNode?.parentElement?.closest('ol');
      if (list && trigger.start !== 1) list.setAttribute('start', String(trigger.start));
    } else if (trigger.type === 'unordered') {
      document.execCommand('insertUnorderedList');
    } else {
      const id = crypto.randomUUID();
      document.execCommand(
        'insertHTML',
        false,
        `<ul><li data-a11y-task-id="${id}" data-a11y-task-complete="${trigger.checked}" data-a11y-task-due="" data-a11y-task-priority="normal"></li></ul>`,
      );
    }
    emitChange();
  };

  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tools.length - 1
          : (activeTool + offset + tools.length) % tools.length;
    if (!offset && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    setActiveTool(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };

  return (
    <>
      <div role="toolbar" aria-label="Rich text formatting" onKeyDown={onToolbarKeyDown}>
        {tools.map((tool, index) => (
          <button
            key={tool.command}
            type="button"
            tabIndex={index === activeTool ? 0 : -1}
            onFocus={() => setActiveTool(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => activate(tool.command)}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div
        ref={editor}
        role="textbox"
        aria-label="Rich text editor"
        aria-multiline="true"
        aria-required="true"
        className="markdown-editor rich-text-editor"
        data-context="editor-selection"
        data-path={notePath}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={onEditorKeyDown}
        onInput={() => {
          if (!editor.current) return;
          const next = sanitizeNoteHtml(editor.current.innerHTML, notePath);
          if (editor.current.innerHTML !== next) editor.current.innerHTML = next;
          onChange(next);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const clipboard = event.clipboardData;
          const html = clipboard.getData('text/html');
          const value = html ? sanitizeNoteHtml(html, notePath) : clipboard.getData('text/plain');
          document.execCommand(html ? 'insertHTML' : 'insertText', false, value);
          if (editor.current) onChange(sanitizeNoteHtml(editor.current.innerHTML, notePath));
        }}
      />
    </>
  );
}
