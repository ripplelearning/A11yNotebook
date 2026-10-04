import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

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
