import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractDocText } from './doc';
import { sanitizeHtmlFragment } from './html-sanitize';
import { convertRtfToHtml } from './rtf';

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

export const DOCUMENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
};

export function protocolPath(url: string): string {
  const match = /^vault-file:\/\/attachment\/([^?#]+)$/.exec(url);
  if (!match) throw new Error('Invalid attachment URL.');
  const relative = match[1].split('/').map((segment) => decodeURIComponent(segment));
  if (relative.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/:\0]/.test(segment))) {
    throw new Error('Invalid attachment path.');
  }
  return relative.join('/');
}

export async function readTextAttachment(resolve: (relative: string) => Promise<string>, relative: string) {
  if (typeof relative !== 'string' || !/\.(?:txt|csv|html?)$/i.test(relative)) {
    throw new Error('Only text, CSV, and HTML previews are supported here.');
  }
  const target = await resolve(relative);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Preview requires a file smaller than 5 MB.');
  return { path: relative, text: await readFile(target, 'utf8'), kind: path.extname(relative).toLowerCase() };
}

/**
 * Preview for legacy word-processing files kept in the library: RTF is
 * converted to a sanitized HTML fragment and legacy .doc text is extracted,
 * so both read as structured documents instead of raw file bytes.
 */
export async function readConvertedAttachment(resolve: (relative: string) => Promise<string>, relative: string) {
  const extension = path.extname(relative).toLowerCase();
  if (extension !== '.rtf' && extension !== '.doc') throw new Error('Only RTF and DOC previews are converted here.');
  const target = await resolve(relative);
  const stat = await lstat(target);
  const limit = extension === '.rtf' ? 20 * 1024 * 1024 : 40 * 1024 * 1024;
  if (!stat.isFile() || stat.size > limit) throw new Error('Preview requires a smaller document file.');
  const bytes = await readFile(target);
  if (extension === '.rtf') {
    return { path: relative, text: sanitizeHtmlFragment(convertRtfToHtml(bytes.toString('latin1'))), kind: '.html' };
  }
  return { path: relative, text: extractDocText(bytes), kind: '.txt' };
}
