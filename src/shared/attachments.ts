export interface AttachmentPreview {
  path: string;
  text: string;
  kind: string;
  pages?: string[];
}

export function imageUrl(relative: string) {
  return `vault-file://attachment/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

/** Human-readable file type for an attachment path ("PDF", "Word document"). */
const ATTACHMENT_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  epub: 'ePub',
  docx: 'Word document',
  doc: 'Word document',
  xlsx: 'Excel spreadsheet',
  xls: 'Excel spreadsheet',
  ods: 'Spreadsheet',
  csv: 'CSV',
  pptx: 'PowerPoint presentation',
  odp: 'Presentation',
  txt: 'Text file',
  html: 'Web page',
  htm: 'Web page',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  bmp: 'Image',
  mp3: 'Audio',
  wav: 'Audio',
  m4a: 'Audio',
  ogg: 'Audio',
  flac: 'Audio',
  webm: 'Audio',
};

/**
 * The Type-column label for an attachment: its real file type instead of
 * the generic "Attachment". Unknown extensions keep "Attachment".
 */
export function attachmentTypeLabel(path: string): string {
  const match = /\.([^./\\]+)$/.exec(path.trim());
  if (!match) return 'Attachment';
  return ATTACHMENT_TYPE_LABELS[match[1].toLowerCase()] ?? 'Attachment';
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
