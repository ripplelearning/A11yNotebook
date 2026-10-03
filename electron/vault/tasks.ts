// Parses checkbox tasks from ordinary Markdown without changing the source format.
import MarkdownIt from 'markdown-it';
import type { VaultTask } from '../../src/shared/types';

const markdown = new MarkdownIt();

/** Return Markdown checkbox tasks with their source line and optional due date/priority. */
export function parseMarkdownTasks(content: string, relativePath: string): VaultTask[] {
  const excludedLines = new Set<number>();
  markdown.parse(content, {}).forEach((token) => {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) excludedLines.add(line);
    }
  });
  return content.split(/\r?\n/).flatMap((lineText, index) => {
    if (excludedLines.has(index)) return [];
    const checkbox = lineText.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (!checkbox) return [];
    const text = checkbox[2].trim();
    const dueDate = text.match(/(?:📅\s*|due:)(\d{4}-\d{2}-\d{2})/i)?.[1];
    const priority = text.match(/priority:(low|normal|high|urgent)\b/i)?.[1]?.toLowerCase() as VaultTask['priority'];
    const title = text
      .replace(/(?:📅\s*|due:)\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/priority:(?:low|normal|high|urgent)\b/gi, '')
      .trim();
    return [
      {
        id: `${relativePath}:${index + 1}`,
        path: relativePath,
        line: index + 1,
        text: title,
        complete: checkbox[1].toLowerCase() === 'x',
        ...(dueDate ? { dueDate } : {}),
        ...(priority ? { priority } : {}),
      },
    ];
  });
}
