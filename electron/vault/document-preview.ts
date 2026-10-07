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

export function extractPdfPages(bytes: Buffer): string[] {
  if (bytes.length > MAX_DOCUMENT_BYTES || !bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('This PDF is invalid or too large to preview.');
  }
  const source = bytes.toString('latin1');
  const objects = new Map<string, string>();
  for (const match of source.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj\b/g)) {
    objects.set(`${match[1]} ${match[2]}`, match[3]);
  }
  const pages: string[] = [];
  const visited = new Set<string>();
  const catalog = [...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body));
  const root = catalog && /\/Pages\s+(\d+)\s+(\d+)\s+R\b/.exec(catalog);
  const pending = root ? [`${root[1]} ${root[2]}`] : [];
  while (pending.length && pages.length < 200) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const body = objects.get(id) ?? '';
    if (/\/Type\s*\/Page\b/.test(body)) pages.push(id);
    else if (/\/Type\s*\/Pages\b/.test(body)) {
      const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(body)?.[1] ?? '';
      const references = [...kids.matchAll(/(\d+)\s+(\d+)\s+R\b/g)];
      for (const reference of references.reverse()) pending.push(`${reference[1]} ${reference[2]}`);
    }
  }
  if (!root) {
    for (const [id, body] of objects) {
      if (/\/Type\s*\/Page\b/.test(body)) pages.push(id);
      if (pages.length >= 200) break;
    }
  }
  let extractedBytes = 0;
  const extractStream = (content: string) => {
    const stream = /stream(?:\r\n|\n|\r)/.exec(content);
    if (!stream || extractedBytes >= MAX_EXTRACTED_BYTES) return '';
    const start = stream.index + stream[0].length;
    const end = content.indexOf('endstream', start);
    if (end < 0 || end - start > MAX_EXTRACTED_BYTES - extractedBytes) return '';
    const dictionary = content.slice(0, stream.index);
    let data = Buffer.from(content.slice(start, end), 'latin1');
    if (data.at(-1) === 10) data = data.subarray(0, data.length - 1);
    if (data.at(-1) === 13) data = data.subarray(0, data.length - 1);
    if (/\/Filter\s*(?:\/FlateDecode\b|\[\s*\/FlateDecode\s*\])/.test(dictionary)) {
      try {
        data = inflateSync(data, { maxOutputLength: MAX_EXTRACTED_BYTES - extractedBytes });
      } catch {
        return '';
      }
    } else if (/\/Filter\b/.test(dictionary)) {
      return '';
    }
    if (extractedBytes + data.length > MAX_EXTRACTED_BYTES) return '';
    extractedBytes += data.length;
    return data.toString('latin1');
  };
  if (root || pages.length) {
    return pages.map((id) => {
      const contents = /\/Contents\s*(\[[\s\S]*?\]|\d+\s+\d+\s+R\b)/.exec(objects.get(id) ?? '')?.[1] ?? '';
      const streams = [...contents.matchAll(/(\d+)\s+(\d+)\s+R\b/g)].map((reference) =>
        extractStream(objects.get(`${reference[1]} ${reference[2]}`) ?? ''),
      );
      return extractTextOperators(streams.join('\n'));
    });
  }
  const streams = [...source.matchAll(/<<(.*?)>>\s*stream(?:\r\n|\n|\r)[\s\S]*?endstream/gims)].map((match) =>
    extractStream(match[0]),
  );
  const nonStreamSource = source.replace(/<<(.*?)>>\s*stream(?:\r\n|\n|\r)[\s\S]*?endstream/gims, '');
  const text = extractTextOperators(`${nonStreamSource}\n${streams.join('\n')}`);
  return text ? [text] : [];
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
