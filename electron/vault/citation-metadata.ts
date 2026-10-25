/**
 * Best-effort citation auto-fill from a DOI, ISBN, or URL, using only
 * public metadata services (Crossref, Open Library) and the page's own
 * citation meta tags. No API keys. Failures are plain errors so the dialog
 * can fall back to manual entry.
 */
import type { BibliographyEntry, CitationAuthor } from '../../src/shared/citations';

const TIMEOUT_MS = 15000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'A11yNotebook/1.7 (citation lookup)' },
    });
    if (!response.ok) throw new Error(`Metadata service returned ${response.status}.`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'A11yNotebook/1.7 (citation lookup)' },
    });
    if (!response.ok) throw new Error(`That page returned ${response.status}.`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function crossrefAuthors(message: Record<string, unknown>): CitationAuthor[] {
  const raw = message.author;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (author): author is Record<string, unknown> =>
        typeof author === 'object' && author !== null && typeof author.family === 'string',
    )
    .map((author) => ({ last: author.family as string, first: (author.given as string | undefined) ?? '' }));
}

function crossrefYear(message: Record<string, unknown>): string {
  for (const key of ['published-print', 'published', 'issued', 'created']) {
    const part = message[key] as { 'date-parts'?: unknown[][] } | undefined;
    const year = part?.['date-parts']?.[0]?.[0];
    if (typeof year === 'number') return String(year);
  }
  return '';
}

async function fromDoi(doi: string): Promise<Partial<BibliographyEntry>> {
  const data = (await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)) as {
    message?: Record<string, unknown>;
  };
  const message = data.message;
  const title = (message?.title as string[] | undefined)?.[0];
  if (!message || !title) throw new Error('No metadata found for that DOI.');
  const type = message.type as string | undefined;
  const sourceType =
    type === 'book' || type === 'monograph'
      ? 'book'
      : type === 'book-chapter'
        ? 'chapter'
        : type === 'proceedings-article'
          ? 'conference'
          : type === 'report'
            ? 'report'
            : type === 'dissertation'
              ? 'thesis'
              : 'journal';
  const container =
    (message['container-title'] as string[] | undefined)?.[0] ??
    (message['short-container-title'] as string[] | undefined)?.[0];
  const page = message.page as string | undefined;
  return {
    sourceType,
    authors: crossrefAuthors(message),
    title,
    year: crossrefYear(message),
    publisher: message.publisher as string | undefined,
    journal: sourceType === 'journal' ? container : undefined,
    containerTitle: sourceType === 'chapter' ? container : undefined,
    conferenceName: sourceType === 'conference' ? container : undefined,
    volume: message.volume as string | undefined,
    issue: message.issue as string | undefined,
    pages: page?.replace('-', '–'),
    doi,
    url: (message.URL as string | undefined) ?? `https://doi.org/${doi}`,
  };
}

async function fromIsbn(isbn: string): Promise<Partial<BibliographyEntry>> {
  const digits = isbn.replace(/[^0-9Xx]/g, '');
  const data = (await fetchJson(`https://openlibrary.org/isbn/${digits}.json`)) as Record<string, unknown>;
  if (typeof data.title !== 'string') throw new Error('No metadata found for that ISBN.');
  const authorKeys = Array.isArray(data.authors)
    ? (data.authors as Array<{ key?: string }>).map((author) => author.key).filter(Boolean)
    : [];
  const authors: CitationAuthor[] = [];
  for (const key of authorKeys.slice(0, 5)) {
    try {
      const author = (await fetchJson(`https://openlibrary.org${key}.json`)) as Record<string, unknown>;
      if (typeof author.name === 'string') {
        const words = author.name.split(/\s+/);
        authors.push(
          words.length > 1
            ? { last: words[words.length - 1], first: words.slice(0, -1).join(' ') }
            : { last: words[0], first: '' },
        );
      }
    } catch {
      // One missing author record must not lose the whole entry.
    }
  }
  const publishDate = data.publish_date as string | undefined;
  const year = publishDate ? (/\d{4}/.exec(publishDate)?.[0] ?? '') : '';
  const publishers = data.publishers as string[] | undefined;
  return {
    sourceType: 'book',
    authors,
    title: data.title as string,
    year,
    publisher: publishers?.[0],
    isbn: digits,
  };
}

function metaContent(html: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const forward = pattern.exec(html)?.[1];
  if (forward) return forward;
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]* (?:name|property)=["']${name}["']`,
    'i',
  ).exec(html)?.[1];
  return reversed;
}

async function fromUrl(url: string): Promise<Partial<BibliographyEntry>> {
  const html = await fetchText(url);
  const title =
    metaContent(html, 'citation_title') ??
    metaContent(html, 'og:title') ??
    /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (!title) throw new Error('That page has no readable title to cite.');
  const authors = (metaContent(html, 'citation_author') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const words = part.split(/\s+/);
      return words.length > 1
        ? { last: words[words.length - 1], first: words.slice(0, -1).join(' ') }
        : { last: words[0], first: '' };
    });
  const date = metaContent(html, 'citation_date') ?? metaContent(html, 'article:published_time');
  const journal = metaContent(html, 'citation_journal_title');
  const doi = metaContent(html, 'citation_doi');
  return {
    sourceType: journal ? 'journal' : 'website',
    authors,
    title,
    year: date ? (/\d{4}/.exec(date)?.[0] ?? '') : '',
    journal,
    publisher: metaContent(html, 'citation_publisher') ?? metaContent(html, 'og:site_name'),
    doi,
    url,
    accessed: new Date().toISOString().slice(0, 10),
  };
}

/** Detect a DOI, ISBN, or URL and fetch what its public metadata offers. */
export async function fetchCitationMetadata(
  identifier: string,
): Promise<Partial<BibliographyEntry>> {
  const value = identifier.trim();
  if (!value) throw new Error('Enter a DOI, ISBN, or URL to look up.');
  if (/^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(value)) return fromDoi(value);
  const digits = value.replace(/[^0-9Xx]/g, '');
  if (/^(?:\d{10}|\d{13}|\d{9}[Xx])$/.test(digits)) return fromIsbn(value);
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported address.');
    return fromUrl(parsed.href);
  } catch (error) {
    if (error instanceof Error && /No metadata|page|title/.test(error.message)) throw error;
    throw new Error('That does not look like a DOI, ISBN, or web address.');
  }
}
