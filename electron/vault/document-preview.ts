import { lstat, readFile } from 'node:fs/promises';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { decodeHtmlEntities } from './html-entities';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_EPUB_ENTRIES = 10_000;

function decodePdfString(token: string) {
  if (token.startsWith('(')) {
    const raw = token.slice(1, -1);
    const bytes: number[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (char !== '\\') {
        bytes.push(raw.charCodeAt(index) & 0xff);
        continue;
      }
      const escaped = raw[++index];
      const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (escaped in simple) bytes.push(simple[escaped]);
      else if (/[0-7]/.test(escaped ?? '')) {
        let octal = escaped;
        for (let count = 0; count < 2 && /[0-7]/.test(raw[index + 1] ?? ''); count += 1) octal += raw[++index];
        bytes.push(parseInt(octal, 8));
      } else if (escaped !== '\n' && escaped !== '\r') bytes.push((escaped ?? '').charCodeAt(0) & 0xff);
    }
    return Buffer.from(bytes).toString('latin1');
  }
  const hex = token.slice(1, -1).replace(/\s/g, '');
  if (hex.length % 2 || !/^[\da-f]*$/i.test(hex)) return '';
  const bytes = Buffer.from(hex, 'hex');
  if (
    bytes.length > 1 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xff) ||
      bytes.filter((_byte, index) => index % 2 === 0 && _byte === 0).length > 0)
  ) {
    const units: number[] = [];
    const start = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    for (let offset = start; offset + 1 < bytes.length; offset += 2) units.push(bytes.readUInt16BE(offset));
    return String.fromCharCode(...units);
  }
  return bytes.toString('latin1');
}

function extractTextOperators(source: string) {
  const output: string[] = [];
  const single = /(\((?:\\.|[^\\)])*\)|<[0-9a-f\s]*>)\s*Tj\b/gim;
  for (const match of source.matchAll(single)) output.push(decodePdfString(match[1]));
  const arrays = /\[((?:\\[\s\S]|[^\\\]])*)\]\s*TJ\b/gim;
  for (const match of source.matchAll(arrays)) {
    const pieces = match[1].match(/\((?:\\.|[^\\)])*\)|<[0-9a-f\s]*>/gim) ?? [];
    output.push(pieces.map(decodePdfString).join(''));
  }
  return output.join(' ').replace(/\s+/g, ' ').trim();
}

function extractPdfStream(object: string, remainingBytes: number) {
  const match = /<<(.*?)>>\s*stream\r?\n/gims.exec(object);
  if (!match) return;
  const start = match.index + match[0].length;
  const end = object.indexOf('endstream', start);
  if (end < 0 || end - start > remainingBytes) return;
  const data = Buffer.from(object.slice(start, end), 'latin1');
  if (match[1].includes('/FlateDecode')) {
    try {
      const inflated = inflateSync(data, { maxOutputLength: remainingBytes });
      return { content: inflated.toString('latin1'), bytes: inflated.length };
    } catch {
      return;
    }
  }
  return { content: data.toString('latin1'), bytes: data.length };
}

export function extractPdfPages(bytes: Buffer): string[] {
  if (bytes.length > MAX_DOCUMENT_BYTES || !bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('This PDF is invalid or too large to preview.');
  }
  const source = bytes.toString('latin1');
  const objects = new Map<number, string>();
  const orderedObjects: { id: number; body: string }[] = [];
  for (const match of source.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)) {
    const object = { id: Number(match[1]), body: match[2] };
    objects.set(object.id, object.body);
    orderedObjects.push(object);
  }
  const pageTree = orderedObjects.find(({ body }) => /\/Type\s*\/Catalog\b/.test(body));
  const pagesRoot = pageTree && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(pageTree.body)?.[1];
  const pageObjects: string[] = [];
  const visited = new Set<number>();
  const visitPageTree = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const object = objects.get(id);
    if (!object) return;
    if (/\/Type\s*\/Page\b/.test(object)) {
      pageObjects.push(object);
      return;
    }
    const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(object)?.[1];
    if (kids) {
      for (const child of kids.matchAll(/(\d+)\s+\d+\s+R/g)) visitPageTree(Number(child[1]));
    }
  };
  if (pagesRoot) visitPageTree(Number(pagesRoot));
  if (!pageObjects.length) {
    pageObjects.push(...orderedObjects.filter(({ body }) => /\/Type\s*\/Page\b/.test(body)).map(({ body }) => body));
  }

  if (pageObjects.length) {
    let extractedBytes = 0;
    const pages = pageObjects.slice(0, 200).map((page) => {
      const contents = /\/Contents\s*(\[[\s\S]*?\]|\d+\s+\d+\s+R)/.exec(page)?.[1] ?? '';
      const streams: string[] = [];
      for (const reference of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
        if (extractedBytes >= MAX_EXTRACTED_BYTES) break;
        const object = objects.get(Number(reference[1]));
        if (!object) continue;
        const stream = extractPdfStream(object, MAX_EXTRACTED_BYTES - extractedBytes);
        if (!stream) continue;
        extractedBytes += stream.bytes;
        streams.push(stream.content);
      }
      return extractTextOperators(streams.join('\n'));
    });
    return pages;
  }

  const streams: string[] = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n/gims;
  let extractedBytes = 0;
  for (const match of source.matchAll(streamPattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf('endstream', start);
    if (end < 0 || end - start > MAX_EXTRACTED_BYTES) continue;
    if (extractedBytes >= MAX_EXTRACTED_BYTES) break;
    const data = bytes.subarray(start, end);
    if (match[1].includes('/FlateDecode')) {
      try {
        const inflated = inflateSync(data, { maxOutputLength: MAX_EXTRACTED_BYTES - extractedBytes });
        extractedBytes += inflated.length;
        streams.push(inflated.toString('latin1'));
      } catch {
        continue;
      }
    } else {
      extractedBytes += data.length;
      streams.push(data.toString('latin1'));
    }
  }
  const nonStreamSource = source.replace(/<<(.*?)>>\s*stream\r?\n[\s\S]*?endstream/gims, '');
  const text = extractTextOperators(`${nonStreamSource}\n${streams.join('\n')}`);
  return text
    .split('\f')
    .map((page) => page.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function decodeHtmlText(html: string) {
  const text = html
    .replace(/<(script|style|svg|head|nav|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return decodeHtmlEntities(text);
}

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const lower = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let index = bytes.length - 22; index >= lower; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('This ePub archive is invalid.');
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  if (count > MAX_EPUB_ENTRIES || cursor + directorySize > end) throw new Error('This ePub archive is too large.');
  const entries = new Map<string, Buffer>();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('This ePub archive is invalid.');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (!name || name.startsWith('/') || name.split(/[\\/]/).includes('..')) continue;
    if (flags & 1) throw new Error('Encrypted ePub archives are not supported.');
    if (uncompressedSize > MAX_EXTRACTED_BYTES || compressedSize > MAX_DOCUMENT_BYTES) {
      throw new Error('An ePub item is too large to preview.');
    }
    total += uncompressedSize;
    if (total > MAX_EXTRACTED_BYTES || localOffset + 30 > bytes.length)
      throw new Error('The ePub expands beyond preview limits.');
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('This ePub archive is invalid.');
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let content: Buffer;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = inflateRawSync(compressed, { maxOutputLength: MAX_EXTRACTED_BYTES });
    else continue;
    if (content.length !== uncompressedSize) throw new Error('This ePub item is damaged.');
    entries.set(name, content);
  }
  return entries;
}

export function extractEpubPages(bytes: Buffer): string[] {
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('This ePub is too large to preview.');
  const entries = readZipEntries(bytes);
  const container = entries.get('META-INF/container.xml')?.toString('utf8') ?? '';
  const packagePath = /<rootfile\b[^>]*full-path=["']([^"']+)["']/i.exec(container)?.[1];
  if (!packagePath) throw new Error('The ePub package document is missing.');
  const packageXml = entries.get(packagePath)?.toString('utf8');
  if (!packageXml) throw new Error('The ePub package document is invalid.');
  const packageDirectory = packagePath.split('/').slice(0, -1).join('/');
  const manifest = new Map<string, string>();
  for (const item of packageXml.matchAll(/<item\b([^>]+)>/gi)) {
    const id = /\bid=["']([^"']+)["']/i.exec(item[1])?.[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(item[1])?.[1];
    if (id && href && !href.startsWith('/') && !href.split('/').includes('..')) {
      manifest.set(id, [packageDirectory, decodeURIComponent(href)].filter(Boolean).join('/'));
    }
  }
  const pages: string[] = [];
  for (const itemref of packageXml.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*\/?>/gi)) {
    const entryName = manifest.get(itemref[1]);
    const content = entryName ? entries.get(entryName) : undefined;
    if (content) pages.push(decodeHtmlText(content.toString('utf8')));
  }
  if (!pages.length) throw new Error('The ePub contains no readable book content.');
  return pages;
}

export async function readDocumentAttachment(resolve: (relative: string) => Promise<string>, relative: string) {
  if (!/\.(?:pdf|epub)$/i.test(relative)) throw new Error('Only PDF and ePub documents are supported.');
  const target = await resolve(relative);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw new Error('Document is too large to preview.');
  const bytes = await readFile(target);
  const kind = relative.toLowerCase().endsWith('.pdf') ? '.pdf' : '.epub';
  const pages = kind === '.pdf' ? extractPdfPages(bytes) : extractEpubPages(bytes);
  return { path: relative, kind, text: pages.join('\n\n'), pages };
}
