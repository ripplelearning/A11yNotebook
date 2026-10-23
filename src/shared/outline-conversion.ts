import { serializeOutline, type OutlineNode } from './assets';

export interface OutlineConversion {
  /** Serialized .outline.md content (a nested Markdown list). */
  outline: string;
  /** Human-readable notes about anything the conversion changed or omitted. */
  warnings: string[];
}

/**
 * Convert a Markdown note into an outline asset: headings become nested
 * outline items by level, body text becomes the item text, and lists nest
 * under their heading. The conversion is deliberately conservative: fenced
 * code, tables, and images are kept verbatim as text, blockquote markers are
 * removed (the text is kept), and YAML front matter is omitted with a
 * warning. Nothing is silently dropped.
 */
export function convertMarkdownToOutline(source: string): OutlineConversion {
  const warnings: string[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;

  // YAML front matter is metadata, not outline content.
  if (lines[0]?.trim() === '---') {
    let end = 1;
    while (end < lines.length && lines[end].trim() !== '---' && lines[end].trim() !== '...') end += 1;
    if (end < lines.length) {
      warnings.push('Front matter was omitted from the outline.');
      index = end + 1;
    }
  }

  const roots: OutlineNode[] = [];
  let nextId = 0;
  const makeNode = (text: string, ordered = false): OutlineNode => ({
    id: `outline-${++nextId}`,
    text,
    children: [],
    ordered,
  });

  const headingStack: Array<{ level: number; node: OutlineNode }> = [];
  let currentNode: OutlineNode | null = null; // node receiving body content
  const listStack: Array<{ indent: number; node: OutlineNode }> = [];
  let inFence = false;
  let fenceMarker = '';
  let sawBlockquote = false;
  let sawSkippedLevel = false;
  let previousLineWasText = false;
  let previousTextLine = '';
  const lastText: { target: OutlineNode | null } = { target: null };

  const appendText = (text: string) => {
    // Continuation lines inside a list item extend that item, not its heading.
    const target = listStack.at(-1)?.node ?? currentNode;
    if (!target) {
      currentNode = makeNode(text);
      roots.push(currentNode);
      lastText.target = currentNode;
      return;
    }
    target.text = target.text ? `${target.text}\n${text}` : text;
    lastText.target = target;
  };

  const removeNode = (node: OutlineNode) => {
    const visit = (items: OutlineNode[]): boolean => {
      const at = items.indexOf(node);
      if (at >= 0) {
        items.splice(at, 1);
        return true;
      }
      return items.some((item) => visit(item.children));
    };
    visit(roots);
  };

  const addHeading = (level: number, text: string) => {
    if (headingStack.length && level > headingStack.at(-1)!.level + 1) sawSkippedLevel = true;
    while (headingStack.length && headingStack.at(-1)!.level >= level) headingStack.pop();
    const node = makeNode(text);
    const parent = headingStack.at(-1)?.node;
    if (parent) parent.children.push(node);
    else roots.push(node);
    headingStack.push({ level, node });
    currentNode = node;
    listStack.length = 0;
  };

  for (; index < lines.length; index += 1) {
    const line = lines[index];

    if (inFence) {
      appendText(line);
      if (line.trimStart().startsWith(fenceMarker)) inFence = false;
      previousLineWasText = false;
      continue;
    }
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      inFence = true;
      fenceMarker = fence[1].slice(0, 3);
      appendText(line);
      previousLineWasText = false;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      addHeading(heading[1].length, heading[2]);
      previousLineWasText = false;
      continue;
    }

    // Setext headings: a text line underlined with === (level 1) or --- (level 2).
    if (/^\s*(=+|-+)\s*$/.test(line) && previousLineWasText && lastText.target) {
      const level = line.trimStart().startsWith('=') ? 1 : 2;
      const target = lastText.target;
      if (target.text === previousTextLine || target.text.endsWith(`\n${previousTextLine}`)) {
        target.text = target.text.slice(0, target.text.length - previousTextLine.length).replace(/\n$/, '');
        // A node emptied by the promotion (and childless) would serialize as
        // a blank item; remove it before adding the heading in its place.
        if (!target.text && target.children.length === 0) {
          removeNode(target);
          if (currentNode === target) currentNode = headingStack.at(-1)?.node ?? null;
        }
        addHeading(level, previousTextLine);
      }
      previousLineWasText = false;
      continue;
    }

    if (!line.trim()) {
      previousLineWasText = false;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      previousLineWasText = false; // horizontal rule: a separator, not content
      continue;
    }

    const listItem = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      const indent = listItem[1].replace(/\t/g, '    ').length;
      while (listStack.length && listStack.at(-1)!.indent >= indent) listStack.pop();
      const node = makeNode(listItem[3], /^\d/.test(listItem[2]));
      const parent = listStack.at(-1)?.node ?? currentNode;
      if (parent) parent.children.push(node);
      else roots.push(node);
      listStack.push({ indent, node });
      previousLineWasText = false;
      continue;
    }

    let text = line.trim();
    if (/^>/.test(text)) {
      sawBlockquote = true;
      text = text.replace(/^>\s?/, '');
      if (!text) {
        previousLineWasText = false;
        continue;
      }
    }
    appendText(text);
    previousLineWasText = true;
    previousTextLine = text;
  }

  if (sawBlockquote) warnings.push('Blockquote markers were removed; the quoted text was kept.');
  if (sawSkippedLevel) warnings.push('Some heading levels were skipped; the outline nesting was adjusted.');
  if (!roots.length) warnings.push('The note has no content to convert.');
  return { outline: serializeOutline(roots), warnings };
}

/** Confirmation text shown before creating the outline sibling. */
export function outlineConversionWarning(source: string, targetPath: string): { outline: string; message: string } {
  const { outline, warnings } = convertMarkdownToOutline(source);
  const lines = [
    `Create an outline copy at ${targetPath}?`,
    'The original note is kept unchanged.',
    ...warnings.map((warning) => `Note: ${warning}`),
  ];
  return { outline, message: lines.join('\n') };
}
