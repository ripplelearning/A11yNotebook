/**
 * Markdown-style triggers for the rich-text editor, typed at the start of
 * a block. The Space key fires before the space is inserted, so the text
 * before the caret is the trigger itself, with no trailing space yet.
 */
export type SmartTrigger =
  | { type: 'heading'; level: number }
  | { type: 'ordered'; start: number }
  | { type: 'unordered' }
  | { type: 'task'; checked: boolean };

export function detectSmartTrigger(beforeCaret: string): SmartTrigger | null {
  const heading = /^(#{1,6})$/.exec(beforeCaret);
  if (heading) return { type: 'heading', level: heading[1].length };
  const ordered = /^(\d+)\.$/.exec(beforeCaret);
  if (ordered) return { type: 'ordered', start: Number(ordered[1]) };
  if (beforeCaret === '*' || beforeCaret === '-') return { type: 'unordered' };
  if (beforeCaret === '[]') return { type: 'task', checked: false };
  if (/^\[x\]$/i.test(beforeCaret)) return { type: 'task', checked: true };
  return null;
}

export interface ListContinuation {
  value: string;
  caret: number;
  /**
   * What the screen reader should hear for the automatic change: the new
   * marker itself for ordered lists ("3."), "bullet" for unordered ones,
   * "task" for checklist items, or "List ended." when Enter ends the list.
   * Without this, the inserted marker lands silently and the user cannot
   * tell what the editor just did.
   */
  announcement: string;
}

/**
 * Word/Docs-style list continuation for the Markdown source textarea.
 * Plain Enter on a list line inserts the next item; Enter on an empty
 * item removes its marker and ends the list, so a second Enter in a row
 * stops the list. Returns null when the caret is not on a list line, so
 * the default Enter behavior applies.
 */
export function continueMarkdownList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ListContinuation | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = selectionStart;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineBreak = value.indexOf('\n', caret);
  const lineEnd = lineBreak === -1 ? value.length : lineBreak;
  const line = value.slice(lineStart, lineEnd);
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!match) return null;
  const [, indent, marker, rest] = match;
  const task = /^(\[[ xX]\])\s+(.*)$/.exec(rest);
  const itemText = task ? task[2] : rest;
  const afterCaret = value.slice(caret, lineEnd);
  if (!itemText && !afterCaret) {
    // Empty item: Enter ends the list instead of adding another marker.
    return { value: value.slice(0, lineStart) + value.slice(lineEnd), caret: lineStart, announcement: 'List ended.' };
  }
  let nextMarker: string;
  const ordered = /^(\d+)([.)])$/.exec(marker);
  if (ordered) nextMarker = task ? `${Number(ordered[1]) + 1}${ordered[2]} [ ]` : `${Number(ordered[1]) + 1}${ordered[2]}`;
  else if (task) nextMarker = `${marker} [ ]`;
  else nextMarker = marker;
  const announcement = task ? 'task' : ordered ? nextMarker : 'bullet';
  const insert = `\n${indent}${nextMarker} `;
  return {
    value: value.slice(0, caret) + insert + value.slice(caret),
    caret: caret + insert.length,
    announcement,
  };
}
