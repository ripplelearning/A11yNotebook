// Parses checkbox tasks from ordinary Markdown without changing the source format.
import type { VaultTask } from '../../src/shared/types';

/** Return Markdown checkbox tasks with their source line and optional due date/priority. */
export function parseMarkdownTasks(content: string, relativePath: string): VaultTask[] {
  return content.split(/\r?\n/).flatMap((lineText, index) => {
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
