import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request, type RequestOptions } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { decodeHtmlEntities } from './html-entities';
import { sanitizeHtmlFragment } from './html-sanitize';

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
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7));
    const first = parseInt(normalized.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith('2001:db8:');
  }
  return false;
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
        family: address.family,
        timeout: 12_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('error', reject);
        response.on('aborted', () => reject(new Error('The remote download was interrupted.')));
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
    const deadline = setTimeout(() => outgoing.destroy(new Error('The remote server timed out.')), 12_000);
    outgoing.once('close', () => clearTimeout(deadline));
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

async function downloadCaptureImagesDetailed(html: string, pageUrl: string) {
  const imageUrls = new Set<string>();
  let missingAlt = 0;
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const sourceMatch = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(match[0]);
    const altMatch = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
    if (!altMatch || !decodeHtmlEntities(altMatch[1] ?? altMatch[2] ?? altMatch[3] ?? '').trim()) {
      missingAlt += 1;
      continue;
    }
    const source = decodeHtmlEntities(sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3] ?? '');
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
  return { images: captured, omittedImages: missingAlt + Math.max(0, imageUrls.size - captured.length) };
}

export async function downloadCaptureImages(html: string, pageUrl: string): Promise<CapturedImage[]> {
  return (await downloadCaptureImagesDetailed(html, pageUrl)).images;
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
  source = source.replace(/<li\b([^>]*)>([\s\S]*?)<\/li\s*>/gi, (_tag, attributes: string, body: string) => {
    const checkbox = /<input\b[^>]*\btype\s*=\s*(?:"checkbox"|'checkbox'|checkbox)[^>]*>/i.exec(body);
    const prefix = checkbox ? (/\bchecked(?:\s|=|>)/i.test(checkbox[0]) ? '[x] ' : '[ ] ') : '';
    return `<li>${prefix}${checkbox ? body.replace(checkbox[0], '') : body}</li>`;
  });
  source = source
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi, (_tag, table: string) => {
      const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(([, row]) => {
        const cells = [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi)].map(([, cell]) =>
          decodeHtmlEntities(
            cell
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          ).replace(/\|/g, '\\|'),
        );
        return cells.length ? `| ${cells.join(' | ')} |` : '';
      });
      const visible = rows.filter(Boolean);
      if (visible.length > 1) {
        const columns = (visible[0].match(/\|/g)?.length ?? 2) - 1;
        visible.splice(1, 0, `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
      }
      return `\n${visible.join('\n')}\n`;
    })
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
    .replace(/<input\b[^>]*>/gi, '')
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
  const { images, omittedImages } = await downloadCaptureImagesDetailed(html, page.url.href);
  const imageReferences = new Map(
    images.map((image, index) => [image.url, `${imagePrefix}image-${index + 1}${image.extension}`]),
  );
  const fragment = sanitizeHtmlFragment(html, {
    allowVaultImages: true,
    baseUrl: page.url.href,
    imageReferences,
  });
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeUrl = page.url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const htmlContent = sanitizeHtmlFragment(
    `<h1>${safeTitle}</h1><p>Source: <a href="${safeUrl}">${safeUrl}</a></p>${fragment}${
      omittedImages
        ? `<p><strong>Capture notice:</strong> ${omittedImages} image${omittedImages === 1 ? '' : 's'} could not be included. The page's text and other content were retained.</p>`
        : ''
    }`,
    { allowVaultImages: true },
  );
  return {
    sourceUrl: page.url.href,
    title,
    markdown: `${htmlToMarkdown(html, page.url.href, imageReferences)}${
      omittedImages
        ? `\n\n> Capture notice: ${omittedImages} image${omittedImages === 1 ? '' : 's'} could not be included. The page's text and other content were retained.`
        : ''
    }`,
    html: htmlContent,
    images,
    omittedImages,
  };
}
