export interface AttachmentPreview {
  path: string;
  text: string;
  kind: string;
  pages?: string[];
}

export function imageUrl(relative: string) {
  return `vault-file://attachment/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

/** RFC-style quoted CSV fields, including escaped quotes and multiline text. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && (quoted || value === '')) {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && (character === ',' || character === '\n')) {
      row.push(value.replace(/\r$/, ''));
      value = '';
      if (character === '\n') {
        rows.push(row);
        row = [];
      }
    } else value += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}
