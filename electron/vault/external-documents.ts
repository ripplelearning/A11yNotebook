import path from 'node:path';

// OS applications can handle more document formats than the internal parsers.
// Never admit executable, script, installer, or shortcut extensions to this list.
export const EXTERNAL_DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.txt',
  '.csv',
  '.tsv',
  '.rtf',
  '.log',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.rst',
  '.adoc',
  '.tex',
  '.pdf',
  '.epub',
  '.mobi',
  '.azw3',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.odg',
  '.odf',
  '.pages',
  '.numbers',
  '.key',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
]);

export function isExternalDocumentPath(relative: string) {
  return EXTERNAL_DOCUMENT_EXTENSIONS.has(path.extname(relative).toLowerCase());
}
