import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request, type RequestOptions } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import ipaddr from 'ipaddr.js';
import { decodeHtmlEntities } from './html-entities';

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 30;
const MAX_CAPTURED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

function isPublicAddress(address: string) {
  if (!isIP(address)) return false;
  try {
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}

function parseCaptureUrl(value: string): URL {
  if (value.length > 2048) throw new Error('The page URL is too long.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid HTTPS page URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !url.hostname ||
    url.hostname.toLowerCase() === 'localhost' ||
    url.hostname.toLowerCase().endsWith('.localhost') ||
    url.hostname.toLowerCase().endsWith('.local')
  ) {
    throw new Error('Only public HTTPS page URLs can be captured.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new Error('Only public HTTPS page URLs can be captured.');
  }
  return url;
}

export function validateCaptureUrl(value: string) {
  return parseCaptureUrl(value).href;
}

async function publicAddress(hostname: string) {
  const bareHost = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(bareHost)
    ? [{ address: bareHost, family: isIP(bareHost) }]
    : await lookup(bareHost, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('The page host does not resolve to a public address.');
  }
  return addresses[0];
}

function requestHttps(url: URL, address: { address: string; family: number }, maximumBytes: number) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
    const pinnedLookup = ((
      _: string,
      __: unknown,
      callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
    ) => callback(null, address.address, address.family)) as NonNullable<RequestOptions['lookup']>;
    const outgoing = request(
      {
        protocol: 'https:',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: 443,
        servername: url.hostname.replace(/^\[|\]$/g, ''),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'A11yNotebook web capture',
          Accept: 'text/html,image/png,image/jpeg,image/gif,image/webp,image/bmp',
        },
        lookup: pinnedLookup,
        timeout: 12_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximumBytes) {
            outgoing.destroy(new Error('The remote file exceeds the capture size limit.'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('The remote server timed out.')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function fetchPublic(urlValue: string, maximumBytes: number) {
  let url = parseCaptureUrl(urlValue);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const address = await publicAddress(url.hostname);
    const result = await requestHttps(url, address, maximumBytes);
    if (result.status >= 300 && result.status < 400 && result.headers.location) {
      if (redirect === MAX_REDIRECTS) throw new Error('The remote page redirected too many times.');
      url = parseCaptureUrl(new URL(result.headers.location, url).href);
      continue;
    }
    if (result.status < 200 || result.status >= 300)
      throw new Error(`The remote server returned HTTP ${result.status}.`);
    return { ...result, url };
  }
  throw new Error('The remote page could not be reached.');
}

export interface CapturedImage {
  url: string;
  extension: string;
  bytes: Buffer;
}

export async function downloadCaptureImages(html: string, pageUrl: string): Promise<CapturedImage[]> {
  const imageUrls = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const source = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? '');
    try {
      const url = new URL(source, pageUrl);
      if (url.protocol === 'https:') imageUrls.add(url.href);
    } catch {
      continue;
    }
  }
  const captured: CapturedImage[] = [];
  let totalBytes = 0;
  for (const url of [...imageUrls].slice(0, MAX_IMAGES)) {
    try {
      const result = await fetchPublic(url, MAX_IMAGE_BYTES);
      const mime = String(result.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const extension = IMAGE_EXTENSIONS[mime];
      if (extension && totalBytes + result.bytes.length <= MAX_CAPTURED_IMAGE_BYTES) {
        captured.push({ url, extension, bytes: result.bytes });
        totalBytes += result.bytes.length;
      }
    } catch {
      continue;
    }
  }
  return captured;
}

export function htmlToMarkdown(html: string, pageUrl: string, imageReferences: Map<string, string> = new Map()) {
  let source = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|object|form|nav)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  source = source.replace(/<img\b([^>]*)>/gi, (_tag, attributes: string) => {
    const source = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attributes);
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    if (!source) return '';
    try {
      const url = new URL(decodeHtmlEntities(source[1] ?? source[2] ?? source[3] ?? ''), pageUrl).href;
      const local = imageReferences.get(url);
      return local ? `\n![${alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? ''}](${local})\n` : '';
    } catch {
      return '';
    }
  });
  source = source
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_tag, attributes: string, text: string) => {
      const rawHref = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attributes);
      const href = rawHref?.[1] ?? rawHref?.[2] ?? rawHref?.[3] ?? '';
      try {
        const target = new URL(href, pageUrl);
        return ['https:', 'http:', 'mailto:'].includes(target.protocol) ? `[${text}](${target.href})` : text;
      } catch {
        return text;
      }
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (_tag, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<(?:strong|b)\b[^>]*>/gi, '**')
    .replace(/<\/(?:strong|b)\s*>/gi, '**')
    .replace(/<(?:em|i)\b[^>]*>/gi, '*')
    .replace(/<\/(?:em|i)\s*>/gi, '*')
    .replace(/<code\b[^>]*>/gi, '`')
    .replace(/<\/code\s*>/gi, '`')
    .replace(/<pre\b[^>]*>/gi, '\n```\n')
    .replace(/<\/pre\s*>/gi, '\n```\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<blockquote\b[^>]*>/gi, '\n> ')
    .replace(/<\/blockquote\s*>/gi, '\n\n')
    .replace(/<(?:br|\/p|\/div|\/section|\/article|\/ul|\/ol|\/main)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(source)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function captureWebPage(value: string, imagePrefix = '') {
  const page = await fetchPublic(value, MAX_PAGE_BYTES);
  const mime = String(page.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!['text/html', 'application/xhtml+xml'].includes(mime)) {
    throw new Error('The URL did not return an HTML page.');
  }
  const html = page.bytes.toString('utf8');
  const title =
    decodeHtmlEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, ' ') ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || page.url.hostname;
  const images = await downloadCaptureImages(html, page.url.href);
  const imageReferences = new Map(
    images.map((image, index) => [image.url, `${imagePrefix}image-${index + 1}${image.extension}`]),
  );
  return {
    sourceUrl: page.url.href,
    title,
    markdown: htmlToMarkdown(html, page.url.href, imageReferences),
    images,
  };
}
