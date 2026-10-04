export type FormatAction =
  | 'bold'
  | 'italic'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bullet'
  | 'numbered'
  | 'checkbox'
  | 'quote'
  | 'code';

/** Offsets are UTF-16 textarea offsets; selection offsets address the resulting full text. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function insertionEdit(start: number, end: number, text: string): TextEdit {
  return { start, end, text, selectionStart: start + text.length, selectionEnd: start + text.length };
}

export function editContent(content: string, edit: TextEdit): string {
  return content.slice(0, edit.start) + edit.text + content.slice(edit.end);
}

function wrap(content: string, start: number, end: number, marker: string, placeholder: string): TextEdit {
  const selected = content.slice(start, end);
  const hasOpening = (text: string) =>
    text.startsWith(marker) && (marker !== '*' || (text.match(/^\*+/)?.[0].length ?? 0) % 2 === 1);
  const hasClosing = (text: string) =>
    text.endsWith(marker) && (marker !== '*' || (text.match(/\*+$/)?.[0].length ?? 0) % 2 === 1);
  if (selected.length >= marker.length * 2 && hasOpening(selected) && hasClosing(selected)) {
    const text = selected.slice(marker.length, -marker.length);
    return { start, end, text, selectionStart: start, selectionEnd: start + text.length };
  }
  if (start >= marker.length && hasClosing(content.slice(0, start)) && hasOpening(content.slice(end))) {
    return {
      start: start - marker.length,
      end: end + marker.length,
      text: selected,
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    };
  }
  const inner = selected || placeholder;
  return {
    start,
    end,
    text: `${marker}${inner}${marker}`,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + inner.length,
  };
}

export function formatText(content: string, start: number, end: number, action: FormatAction): TextEdit {
  start = Math.max(0, Math.min(start, content.length));
  end = Math.max(start, Math.min(end, content.length));
  if (action === 'bold' || action === 'italic') {
    return wrap(content, start, end, action === 'bold' ? '**' : '*', 'text');
  }
  if (action === 'code') {
    const selected = content.slice(start, end) || 'code';
    const longestFence = Math.max(2, ...(selected.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(longestFence + 1);
    const before = start > 0 && content[start - 1] !== '\n' ? '\n' : '';
    const after = end < content.length && content[end] !== '\n' ? '\n' : '';
    const prefix = `${before}${fence}\n`;
    return {
      start,
      end,
      text: `${prefix}${selected}\n${fence}${after}`,
      selectionStart: start + prefix.length,
      selectionEnd: start + prefix.length + selected.length,
    };
  }

  const lineStart = content.slice(0, start).lastIndexOf('\n') + 1;
  const lastSelected = end > start && content[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = content.indexOf('\n', lastSelected);
  const lineEnd = nextBreak < 0 ? content.length : nextBreak;
  const lines = content.slice(lineStart, lineEnd).split('\n');
  const prefix = (index: number) => {
    if (action.startsWith('heading')) return `${'#'.repeat(Number(action.slice(-1)))} `;
    if (action === 'numbered') return `${index + 1}. `;
    return { bullet: '- ', checkbox: '- [ ] ', quote: '> ' }[action as 'bullet' | 'checkbox' | 'quote'];
  };
  const matching =
    action === 'numbered'
      ? /^\d+[.)] /
      : action === 'checkbox'
        ? /^[-*+] \[[ xX]\] /
        : action === 'bullet'
          ? /^[-*+] (?!\[[ xX]\] )/
          : action === 'quote'
            ? /^> /
            : new RegExp(`^#{${action.slice(-1)}} `);
  const remove = lines.every((line) => matching.test(line));
  const text = lines
    .map((line, index) => {
      if (remove) return line.replace(matching, '');
      const stripped = line.replace(/^(?:#{1,6} |[-*+] (?:\[[ xX]\] )?|\d+[.)] |> )/, '');
      return prefix(index) + stripped;
    })
    .join('\n');
  return { start: lineStart, end: lineEnd, text, selectionStart: lineStart, selectionEnd: lineStart + text.length };
}

export function validateLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    Array.from(trimmed).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    return null;
  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol === 'mailto:' && !url.pathname) return null;
    return url.href.replace(/[()<>]/g, (character) =>
      encodeURIComponent(character).replace(/\(/g, '%28').replace(/\)/g, '%29'),
    );
  } catch {
    return null;
  }
}

export function markdownLink(label: string, url: string): string {
  const destination = validateLinkUrl(url);
  if (!destination) throw new Error('Enter an http, https, or mailto URL without spaces.');
  return `[${(label || 'link').replace(/[\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ')}](${destination})`;
}

export function wikiLink(path: string, label?: string): string {
  const target = path.replace(/\.md$/i, '');
  if (!target.trim() || /[\r\n[\]|]/.test(target)) throw new Error('Choose a valid note path.');
  const safeLabel = label?.replace(/[\r\n[\]|]/g, ' ').trim();
  return `[[${target}${safeLabel ? `|${safeLabel}` : ''}]]`;
}

export function markdownTable(rows: number, columns: number): string {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 50 || columns < 1 || columns > 20) {
    throw new Error('Use 1–50 body rows and 1–20 columns.');
  }
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    row(Array.from({ length: columns }, (_, index) => `Column ${index + 1}`)),
    row(Array.from({ length: columns }, () => '---')),
    ...Array.from({ length: rows }, () => row(Array.from({ length: columns }, () => ''))),
  ].join('\n');
}

/**
 * Prefer browser insertText to retain native undo. The fallback emits a bubbling
 * input event but cannot guarantee native undo. onContentChange is an explicit
 * controlled-value sync callback, invoked once; hosts may also receive onChange.
 */
export function applyTextEdit(
  textarea: HTMLTextAreaElement,
  edit: TextEdit,
  onContentChange?: (content: string) => void,
): void {
  if (textarea.readOnly || textarea.disabled) return;
  textarea.focus();
  textarea.setSelectionRange(edit.start, edit.end);
  const expected = editContent(textarea.value, edit);
  try {
    if (typeof document.execCommand === 'function') document.execCommand('insertText', false, edit.text);
  } catch {
    // Some browser environments do not expose native editing commands.
  }
  if (textarea.value !== expected) {
    textarea.setRangeText(edit.text, edit.start, edit.end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  onContentChange?.(textarea.value);
}
