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
